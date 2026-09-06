const BASE_WIDTH = 1024;
const BASE_HEIGHT = 600;
const MIN_SCALE = 0.78;
const MAX_SCALE = 1.65;

function viewportScale(): number {
    const widthScale = window.innerWidth / BASE_WIDTH;
    const heightScale = window.innerHeight / BASE_HEIGHT;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, widthScale, heightScale));
}

function applyScale(): void {
    const root = document.documentElement;
    const user = Number(root.style.getPropertyValue("--mfx-user-scale") || "1") || 1;
    const scale = viewportScale() * user;
    root.style.setProperty("--mfx-ui-scale", scale.toFixed(4));
    root.style.setProperty("--mfx-font-size", `calc(16px * ${scale.toFixed(4)})`);
    document.documentElement.style.fontSize = `calc(16px * ${scale.toFixed(4)})`;
    root.style.setProperty("--mfx-header-height", `calc(56px * ${scale.toFixed(4)})`);
    root.style.setProperty("--mfx-touch-height", `calc(40px * ${scale.toFixed(4)})`);
    root.style.setProperty("--mfx-touch", `calc(40px * ${scale.toFixed(4)})`);
    root.style.setProperty("--mfx-gap", `calc(8px * ${scale.toFixed(4)})`);
    root.style.setProperty("--mfx-pad", `calc(12px * ${scale.toFixed(4)})`);
}

export function installResponsiveSizing(): () => void {
    applyScale();
    const onResize = () => applyScale();
    window.addEventListener("resize", onResize);
    return () => {
        window.removeEventListener("resize", onResize);
    };
}

export function applyUserScale(userScale: number): void {
    document.documentElement.style.setProperty(
        "--mfx-user-scale",
        String(Number.isFinite(userScale) && userScale > 0 ? userScale : 1)
    );
    applyScale();
}
