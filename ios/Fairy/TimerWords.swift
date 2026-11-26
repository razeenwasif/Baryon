import Foundation

// "Set a timer for 10 minutes", "a pasta timer for an hour and a half", "an alarm in 20 minutes": a timer is set on the
// iPhone itself, so it needs no Mac and rings with the phone locked. "Set an alarm for 7am" and "wake me up at 6:30"
// set an alarm for that time. Anything without "timer", "alarm" or "wake me", or without a length or time this can
// read, goes to Fairy as words.
enum TimerWords {
    struct Clock: Equatable {
        var hour: Int
        var minute: Int
    }
    struct Request: Equatable {
        var seconds: Int
        var label: String?
        // Set for an alarm at a time of day; a timer has only its length.
        var clock: Clock? = nil
    }

    private static let units: [String: Int] = [
        "second": 1, "seconds": 1, "sec": 1, "secs": 1, "s": 1,
        "minute": 60, "minutes": 60, "min": 60, "mins": 60, "m": 60,
        "hour": 3600, "hours": 3600, "hr": 3600, "hrs": 3600, "h": 3600,
    ]
    private static let ones: [String: Double] = [
        "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
        "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
        "seventeen": 17, "eighteen": 18, "nineteen": 19, "couple": 2, "few": 3,
    ]
    private static let tens: [String: Double] = ["twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90]
    // Words that come before "timer" without naming it: "set a timer", "start my timer".
    private static let notLabels: Set<String> = ["a", "an", "the", "my", "set", "start", "new", "quick", "another", "one", "fairy", "please", "for", "am", "pm"]
    private static let longest = 24 * 3600

    static func parse(_ text: String, now: Date = .now) -> Request? {
        let lower = text.lowercased().replacingOccurrences(of: "’", with: "'")
        let timer = lower.range(of: #"\btimers?\b"#, options: .regularExpression) != nil
        let alarm = lower.range(of: #"\balarms?\b|\bwake me\b"#, options: .regularExpression) != nil
        guard timer || alarm,
              lower.range(of: #"\b(?:cancel|stop|delete|remove|turn off|snooze|how long|how much time|what's left|left on|what time)\b"#, options: .regularExpression) == nil else { return nil }
        if alarm, !timer, let clock = clockTime(in: lower, now: now) {
            let words = lower.split { !$0.isLetter && !$0.isNumber }.map(String.init)
            return Request(seconds: clock.seconds, label: label(in: words), clock: clock.time)
        }
        // "10min" and "1h30m" read as "10 min" and "1 h 30 m".
        let spaced = lower.replacingOccurrences(of: #"(\d)([a-z])"#, with: "$1 $2", options: .regularExpression)
            .replacingOccurrences(of: #"([a-z])(\d)"#, with: "$1 $2", options: .regularExpression)
        let words = spaced.split { !$0.isLetter && !$0.isNumber && $0 != "." }.map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: ".")) }.filter { !$0.isEmpty }

        var total = 0.0, number: Double? = nil, lastUnit = 0, fraction: Double? = nil, found = false
        var index = 0
        while index < words.count {
            let word = words[index]
            if let value = Double(word) { number = (number ?? 0) + value }
            else if let value = tens[word] { number = (number ?? 0) + value }
            else if word == "a" || word == "an", fraction != nil { /* "half an hour": the fraction already says how much. */ }
            else if let value = ones[word], !(word == "a" || word == "an") || isUnitAhead(words, from: index + 1) { number = (number ?? 0) + value }
            else if word == "half" || word == "quarter" {
                // "half an hour" and "a quarter of an hour" take a share of what follows; "an hour and a half" adds half
                // of what came before.
                let share = word == "half" ? 0.5 : 0.25
                if isUnitAhead(words, from: index + 1) { fraction = share; number = nil }
                else if lastUnit > 0 { total += Double(lastUnit) * share; found = true }
            } else if let unit = units[word] {
                // A unit counts only with an amount before it: "timer for minute" isn't a length.
                guard number != nil || fraction != nil else { index += 1; continue }
                total += (fraction ?? number ?? 1) * Double(unit)
                lastUnit = unit
                number = nil
                fraction = nil
                found = true
            } else if !["and", "of", "for", "in", "it", "set", "timer", "timers", "to"].contains(word) {
                number = nil
            }
            index += 1
        }
        let seconds = Int(total.rounded())
        guard found, seconds >= 1, seconds <= longest else { return nil }
        return Request(seconds: seconds, label: label(in: words))
    }

    private static func isUnitAhead(_ words: [String], from start: Int) -> Bool {
        for word in words[min(start, words.count)...].prefix(3) {
            if units[word] != nil { return true }
            if !["a", "an", "of"].contains(word) { return false }
        }
        return false
    }

    // "a pasta timer", "a timer for the pasta", "a timer called tea".
    private static func label(in words: [String]) -> String? {
        let spoken = words.filter { Double($0) == nil && units[$0] == nil && ones[$0] == nil && tens[$0] == nil && !["half", "quarter", "and", "hey", "can", "you", "could", "would", "please", "fairy"].contains($0) }
        if let timer = words.firstIndex(where: { $0 == "timer" || $0 == "alarm" }), timer > 0 {
            let before = words[timer - 1]
            if !notLabels.contains(before), spoken.contains(before), Double(before) == nil, units[before] == nil { return before.capitalized }
        }
        guard let joined = words.joined(separator: " ").range(of: #"(?:called|named|labelled|labeled|for (?:the|my)) ([a-z][a-z ]{1,30})$"#, options: .regularExpression) else { return nil }
        let tail = words.joined(separator: " ")[joined].split(separator: " ").dropFirst().filter { !["the", "my"].contains($0) }
        let name = tail.filter { spoken.contains(String($0)) }.joined(separator: " ")
        return name.isEmpty ? nil : name.prefix(1).uppercased() + name.dropFirst()
    }

    // "7am", "6:30 pm", "at 7", "for 18:45", "noon": the next time that clock time comes round. Without am or pm, 7 means
    // whichever of 7:00 and 19:00 is sooner. A number followed by a unit ("for 10 minutes") is a length, not a time.
    static func clockTime(in lower: String, now: Date = .now) -> (time: Clock, seconds: Int)? {
        var hour = -1, minute = 0, half: String? = nil
        if lower.range(of: #"\bnoon\b|\bmidday\b"#, options: .regularExpression) != nil { hour = 12; half = "pm" }
        else if lower.range(of: #"\bmidnight\b"#, options: .regularExpression) != nil { hour = 0 }
        else {
            let pattern = #"(?:\b(?:at|for)\s+)?\b(\d{1,2})(?!\d)(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?!\s*(?:minutes?|mins?|m\b|hours?|hrs?|h\b|seconds?|secs?|s\b))"#
            guard let expression = try? NSRegularExpression(pattern: pattern) else { return nil }
            let range = NSRange(lower.startIndex..., in: lower)
            for match in expression.matches(in: lower, range: range) {
                let whole = Range(match.range, in: lower).map { String(lower[$0]) } ?? ""
                let digits = Range(match.range(at: 1), in: lower).map { Int(lower[$0]) ?? -1 } ?? -1
                let minutes = Range(match.range(at: 2), in: lower).map { Int(lower[$0]) ?? -1 }
                let meridiem = Range(match.range(at: 3), in: lower).map { String(lower[$0]).replacingOccurrences(of: ".", with: "") }
                // A bare number counts as a time only after "at" or "for", or with minutes or am/pm.
                guard minutes != nil || meridiem != nil || whole.hasPrefix("at") || whole.hasPrefix("for") else { continue }
                guard (0...23).contains(digits), (minutes ?? 0) <= 59, meridiem == nil || (1...12).contains(digits) else { continue }
                hour = digits; minute = minutes ?? 0; half = meridiem
                break
            }
        }
        guard hour >= 0 else { return nil }
        let calendar = Calendar.current
        var candidates: [Int]
        if let half { candidates = [hour % 12 + (half == "pm" ? 12 : 0)] }
        else if hour >= 13 || hour == 0 { candidates = [hour] }
        else { candidates = [hour % 12, hour % 12 + 12] }
        let soonest = candidates.compactMap { candidate -> Date? in
            calendar.nextDate(after: now, matching: DateComponents(hour: candidate, minute: minute, second: 0), matchingPolicy: .nextTime)
        }.min()
        guard let soonest else { return nil }
        let parts = calendar.dateComponents([.hour, .minute], from: soonest)
        return (Clock(hour: parts.hour ?? 0, minute: parts.minute ?? 0), max(1, Int(soonest.timeIntervalSince(now).rounded())))
    }

    // "1 hour and 30 minutes", "90 seconds" said as "1 minute and 30 seconds".
    static func spoken(_ seconds: Int) -> String {
        let hours = seconds / 3600, minutes = seconds % 3600 / 60, rest = seconds % 60
        let parts = [(hours, "hour"), (minutes, "minute"), (rest, "second")].filter { $0.0 > 0 }.map { "\($0.0) \($0.1)\($0.0 == 1 ? "" : "s")" }
        switch parts.count {
        case 0: return "0 seconds"
        case 1: return parts[0]
        default: return parts.dropLast().joined(separator: ", ") + " and " + parts.last!
        }
    }
}
