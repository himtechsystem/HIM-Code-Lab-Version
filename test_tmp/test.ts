const paths = [
    "null => main.py",
    "/{dev/null => main.py}",
    "{/dev/null => main.py}",
    "/dev/null => phone_brand_website/app.py",
    "src/{old => new}/index.ts",
    "foo => bar"
];

for (const p of paths) {
    let clean = p;
    // Regex to handle all diff rename variants taking the added side
    // Case 1: "/{dev/null => main.py}" or "{/dev/null => main.py}" -> "main.py"
    clean = clean.replace(/^\/?\{?\/dev\/null\s*=>\s*([^}]+)\}?$/, '$1');
    // Case 2: "null => main.py", "/dev/null => main.py", "foo => bar"
    if (clean.includes('=>')) {
        clean = clean.replace(/\{?[^{}]*\s*=>\s*([^}]+)\}?/, '$1');
    }
    // Remove accidental leading slash from the replacement if it was "/{...}"
    if (clean.startsWith('/') && !p.endsWith(clean)) {
        clean = clean.substring(1);
    }
    console.log(`"${p}" -> "${clean.trim()}"`);
}
