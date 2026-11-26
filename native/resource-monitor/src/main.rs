use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::ffi::c_int;
use std::io::{self, BufRead, Write};
use std::time::{SystemTime, UNIX_EPOCH};

const PROC_PIDTASKALLINFO: c_int = 2;
const TASK_ALL_INFO_SIZE: usize = 232;
const RING_CAPACITY: usize = 3600;

extern "C" {
    fn proc_listallpids(buffer: *mut c_int, buffersize: c_int) -> c_int;
    fn proc_pidinfo(
        pid: c_int,
        flavor: c_int,
        arg: u64,
        buffer: *mut u8,
        buffersize: c_int,
    ) -> c_int;
}

#[derive(Clone)]
struct ProcEntry {
    pid: i32,
    ppid: i32,
    name: String,
    rss_bytes: u64,
    cpu_ns: u64,
}

#[derive(Clone)]
struct TreeSample {
    root_pid: i32,
    timestamp_ms: u128,
    process_count: usize,
    total_rss_bytes: u64,
    total_cpu_ns: u64,
    delta_cpu_ns: u64,
    processes: Vec<ProcEntry>,
}

fn read_u32_le(buf: &[u8], off: usize) -> u32 {
    u32::from_ne_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
}

fn read_u64_le(buf: &[u8], off: usize) -> u64 {
    u64::from_ne_bytes([
        buf[off],
        buf[off + 1],
        buf[off + 2],
        buf[off + 3],
        buf[off + 4],
        buf[off + 5],
        buf[off + 6],
        buf[off + 7],
    ])
}

fn read_cstr(slice: &[u8]) -> String {
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..end]).trim().to_string()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn list_all_pids() -> Vec<i32> {
    let mut cap: usize = 2048;
    for _ in 0..4 {
        let mut pids = vec![0 as c_int; cap];
        let bytes = (pids.len() * std::mem::size_of::<c_int>()) as c_int;
        let ret = unsafe { proc_listallpids(pids.as_mut_ptr(), bytes) };
        if ret <= 0 {
            return Vec::new();
        }
        let count = (ret as usize) / std::mem::size_of::<c_int>();
        if count < cap {
            pids.truncate(count);
            return pids.into_iter().filter(|&p| p > 0).collect();
        }
        cap *= 2;
    }
    Vec::new()
}

fn read_proc_info(pid: i32) -> Option<ProcEntry> {
    let mut buf = [0u8; TASK_ALL_INFO_SIZE];
    let ret = unsafe {
        proc_pidinfo(
            pid as c_int,
            PROC_PIDTASKALLINFO,
            0,
            buf.as_mut_ptr(),
            TASK_ALL_INFO_SIZE as c_int,
        )
    };
    if ret as usize != TASK_ALL_INFO_SIZE {
        return None;
    }
    let parsed_pid = read_u32_le(&buf, 12) as i32;
    let ppid = read_u32_le(&buf, 16) as i32;
    let comm = read_cstr(&buf[48..64]);
    let full_name = read_cstr(&buf[64..96]);
    let name = if !full_name.is_empty() { full_name } else { comm };
    let rss_bytes = read_u64_le(&buf, 144);
    let user_ns = read_u64_le(&buf, 152);
    let sys_ns = read_u64_le(&buf, 160);
    Some(ProcEntry {
        pid: if parsed_pid > 0 { parsed_pid } else { pid },
        ppid,
        name,
        rss_bytes,
        cpu_ns: user_ns.saturating_add(sys_ns),
    })
}

fn sample_tree(root_pid: i32, prev_cpu: &mut HashMap<i32, u64>) -> TreeSample {
    let all_pids = list_all_pids();
    let mut infos: HashMap<i32, ProcEntry> = HashMap::new();
    let mut children: HashMap<i32, Vec<i32>> = HashMap::new();

    // Stage 1: discover PID -> PPID relationships across kernel process table without spawning ps/pgrep.
    for pid in all_pids {
        if let Some(entry) = read_proc_info(pid) {
            children.entry(entry.ppid).or_default().push(entry.pid);
            infos.insert(entry.pid, entry);
        }
    }

    // Stage 2: BFS descendants from root_pid and sum tree RSS / CPU deltas.
    let mut visited: HashSet<i32> = HashSet::new();
    let mut queue: VecDeque<i32> = VecDeque::new();
    queue.push_back(root_pid);

    let mut tree_procs = Vec::new();
    let mut total_rss: u64 = 0;
    let mut total_cpu: u64 = 0;
    let mut delta_cpu: u64 = 0;

    while let Some(pid) = queue.pop_front() {
        if !visited.insert(pid) {
            continue;
        }
        if let Some(entry) = infos.get(&pid) {
            total_rss = total_rss.saturating_add(entry.rss_bytes);
            total_cpu = total_cpu.saturating_add(entry.cpu_ns);
            if let Some(&prev) = prev_cpu.get(&pid) {
                delta_cpu = delta_cpu.saturating_add(entry.cpu_ns.saturating_sub(prev));
            }
            prev_cpu.insert(pid, entry.cpu_ns);
            tree_procs.push(entry.clone());
        }
        if let Some(kids) = children.get(&pid) {
            for &kid in kids {
                if !visited.contains(&kid) {
                    queue.push_back(kid);
                }
            }
        }
    }

    prev_cpu.retain(|pid, _| infos.contains_key(pid));

    TreeSample {
        root_pid,
        timestamp_ms: now_ms(),
        process_count: tree_procs.len(),
        total_rss_bytes: total_rss,
        total_cpu_ns: total_cpu,
        delta_cpu_ns: delta_cpu,
        processes: tree_procs,
    }
}

fn json_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn sample_to_json(sample: &TreeSample) -> String {
    let procs: Vec<String> = sample
        .processes
        .iter()
        .take(128)
        .map(|p| {
            format!(
                "{{\"pid\":{},\"ppid\":{},\"name\":\"{}\",\"rssBytes\":{},\"cpuNs\":{}}}",
                p.pid,
                p.ppid,
                json_escape(&p.name),
                p.rss_bytes,
                p.cpu_ns
            )
        })
        .collect();
    format!(
        "{{\"pid\":{},\"timestampMs\":{},\"processCount\":{},\"totalRssBytes\":{},\"cpuNs\":{},\"deltaCpuNs\":{},\"processes\":[{}]}}",
        sample.root_pid,
        sample.timestamp_ms,
        sample.process_count,
        sample.total_rss_bytes,
        sample.total_cpu_ns,
        sample.delta_cpu_ns,
        procs.join(",")
    )
}

fn parse_pid_field(line: &str) -> Option<i32> {
    let key = "\"pid\":";
    let idx = line.find(key)?;
    let rest = line[idx + key.len()..].trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<i32>().ok().filter(|&p| p > 0)
}

fn parse_limit_field(line: &str) -> usize {
    let key = "\"limit\":";
    if let Some(idx) = line.find(key) {
        let rest = line[idx + key.len()..].trim_start();
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<usize>() {
            return n.clamp(1, RING_CAPACITY);
        }
    }
    120
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut once = false;
    let mut cli_pid: i32 = std::process::id() as i32;
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--once" {
            once = true;
        } else if args[i] == "--pid" && i + 1 < args.len() {
            if let Ok(parsed) = args[i + 1].parse::<i32>() {
                if parsed > 0 {
                    cli_pid = parsed;
                }
            }
            i += 1;
        }
        i += 1;
    }

    let mut prev_cpu: HashMap<i32, u64> = HashMap::new();
    if once {
        let sample = sample_tree(cli_pid, &mut prev_cpu);
        println!("{}", sample_to_json(&sample));
        return;
    }

    let mut ring: VecDeque<TreeSample> = VecDeque::with_capacity(RING_CAPACITY);
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line_res in stdin.lock().lines() {
        let Ok(line) = line_res else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.contains("\"quit\"") {
            let _ = writeln!(stdout, "{{\"ok\":true,\"quit\":true}}");
            let _ = stdout.flush();
            break;
        }
        if trimmed.contains("\"history\"") {
            let limit = parse_limit_field(trimmed);
            let skip = ring.len().saturating_sub(limit);
            let items: Vec<String> = ring.iter().skip(skip).map(sample_to_json).collect();
            let _ = writeln!(
                stdout,
                "{{\"ok\":true,\"capacity\":{},\"len\":{},\"samples\":[{}]}}",
                RING_CAPACITY,
                ring.len(),
                items.join(",")
            );
            let _ = stdout.flush();
            continue;
        }
        let target_pid = parse_pid_field(trimmed).unwrap_or(cli_pid);
        let sample = sample_tree(target_pid, &mut prev_cpu);
        let json = sample_to_json(&sample);
        if ring.len() >= RING_CAPACITY {
            ring.pop_front();
        }
        ring.push_back(sample);
        let _ = writeln!(stdout, "{{\"ok\":true,\"sample\":{}}}", json);
        let _ = stdout.flush();
    }
}
