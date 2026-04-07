export function publicUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${import.meta.env.BASE_URL}${normalizedPath}`;
}
