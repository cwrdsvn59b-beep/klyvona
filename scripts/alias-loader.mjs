export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url);
    return nextResolve(target.href, context);
  }
  return nextResolve(specifier, context);
}
