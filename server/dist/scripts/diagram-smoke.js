const ident = (process.argv[2] ?? 'MSP').toUpperCase();
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:4000';
async function main() {
    const response = await fetch(`${baseUrl}/api/airports/${encodeURIComponent(ident)}/diagram?schematic=1`);
    if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
    }
    const payload = await response.json();
    const runways = payload.runways?.features?.length ?? 0;
    const labels = payload.runwayLabels?.features?.length ?? 0;
    const overlays = payload.overlays?.features?.length ?? 0;
    const apron = payload.schematic?.apron?.features?.length ?? 0;
    const taxi = payload.schematic?.taxi?.features?.length ?? 0;
    console.log(`diagram ${ident}: runways=${runways}, labels=${labels}, overlays=${overlays}, apron=${apron}, taxi=${taxi}`);
}
main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
export {};
