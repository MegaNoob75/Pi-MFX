import { useLayoutEffect, useRef, type HTMLAttributes } from "react";

const TEXT_SELECTOR = ".mfx-performance-ui-label, .mfx-performance-ui-value, .audio-widget-detail > strong, .audio-widget-detail > span";

/** Fit each label/value into its allocated row using the actual font and text. */
export function AutoFitStatusWidget({ enabled, ...props }: HTMLAttributes<HTMLDivElement> & { enabled: boolean }) {
    const rootRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!enabled || !root) return;
        const context = document.createElement("canvas").getContext("2d");
        if (!context) return;
        let frame = 0;
        let disposed = false;
        const fit = () => {
            frame = 0;
            root.querySelectorAll<HTMLElement>(TEXT_SELECTOR).forEach((element) => {
                const width = element.clientWidth - 2;
                const height = element.clientHeight - 2;
                if (width <= 0 || height <= 0) return;
                const style = getComputedStyle(element);
                const text = element.textContent ?? "";
                const lines = (style.textTransform === "uppercase" ? text.toUpperCase() : text).split("\n");
                // Measure at a reference size, then scale to the available row.
                context.font = `${style.fontStyle} ${style.fontWeight} 100px ${style.fontFamily}`;
                const spacing = (parseFloat(style.letterSpacing) || 0) / (parseFloat(style.fontSize) || 1);
                const textWidth = Math.max(...lines.map((line) =>
                    context.measureText(line).width / 100 + line.length * spacing));
                const size = Math.max(1, Math.floor(Math.min(
                    height / (1.08 * lines.length),
                    textWidth > 0 ? width / textWidth : Infinity
                ) * 10) / 10);
                const fontSize = `${size}px`;
                if (element.style.fontSize !== fontSize) element.style.fontSize = fontSize;
            });
        };
        const schedule = () => {
            if (!disposed && !frame) frame = requestAnimationFrame(fit);
        };
        const resize = new ResizeObserver(schedule);
        resize.observe(root);
        const textChanges = new MutationObserver(schedule);
        textChanges.observe(root, { childList: true, characterData: true, subtree: true });
        const themeChanges = new MutationObserver(schedule);
        themeChanges.observe(document.documentElement, { attributes: true });
        document.fonts.addEventListener("loadingdone", schedule);
        void document.fonts.ready.then(schedule);
        fit();
        return () => {
            disposed = true;
            resize.disconnect();
            textChanges.disconnect();
            themeChanges.disconnect();
            document.fonts.removeEventListener("loadingdone", schedule);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [enabled]);
    return <div {...props} ref={rootRef} />;
}
