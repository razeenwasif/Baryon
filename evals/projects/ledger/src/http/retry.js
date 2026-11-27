// Tries a job again when it fails, up to a number of times, waiting a little longer each time.
export async function withRetries(job, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try { return await job(); }
    catch (error) { if (attempt >= retries) throw error; await new Promise(resolve => setTimeout(resolve, 200 * 2 ** attempt)); }
  }
}
