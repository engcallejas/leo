// Tiny client-side fetch helper with JSON + error handling.
async function handle(res: Response) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  get: (url: string) => fetch(url, { cache: "no-store" }).then(handle),
  post: (url: string, body?: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    }).then(handle),
  // Multipart POST — no Content-Type header so the browser sets the boundary.
  postForm: (url: string, form: FormData) =>
    fetch(url, { method: "POST", body: form }).then(handle),
  put: (url: string, body: unknown) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(handle),
  del: (url: string) => fetch(url, { method: "DELETE" }).then(handle),
};
