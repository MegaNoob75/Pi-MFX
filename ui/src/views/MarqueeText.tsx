import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function MarqueeText({
    className,
    text,
    color,
    fontSize,
    fontWeight = 900,
    align = "center",
    textTransform,
    letterSpacing,
    opacity = 1,
    delaySeconds = 2.5,
    pixelsPerSecond = 45,
    endPauseSeconds = 1,
    enabled = true
}: {
    className?: string;
    text: string;
    color?: string;
    fontSize?: string;
    fontWeight?: number | string;
    align?: "left" | "center" | "right";
    textTransform?: "uppercase" | "none";
    letterSpacing?: string;
    opacity?: number;
    delaySeconds?: number;
    pixelsPerSecond?: number;
    endPauseSeconds?: number;
    enabled?: boolean;
}) {
    const viewportRef = useRef<HTMLSpanElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    const [overflow, setOverflow] = useState(0);

    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        const textElement = textRef.current;
        if (!viewport || !textElement) {
            return;
        }
        let frame = 0;
        const measure = () => {
            frame = 0;
            textElement.style.transform = "translateX(0)";
            setOverflow(enabled ? Math.max(0, textElement.scrollWidth - viewport.clientWidth) : 0);
        };
        const schedule = () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
            frame = window.requestAnimationFrame(measure);
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(viewport);
        observer.observe(textElement);
        schedule();
        void document.fonts?.ready.then(schedule).catch(() => undefined);
        return () => {
            observer.disconnect();
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, [text, fontSize, fontWeight, textTransform, letterSpacing, enabled]);

    useEffect(() => {
        const textElement = textRef.current;
        if (!textElement || overflow <= 0 || pixelsPerSecond <= 0) {
            return;
        }
        const scrollSeconds = overflow / pixelsPerSecond;
        const startPause = Math.max(0, delaySeconds);
        const endPause = Math.max(0, endPauseSeconds);
        const total = Math.max(0.1, startPause + scrollSeconds + endPause);
        const animation = textElement.animate(
            [
                { transform: "translateX(0)", offset: 0 },
                { transform: "translateX(0)", offset: Math.min(1, startPause / total) },
                { transform: `translateX(-${overflow}px)`, offset: Math.min(1, (startPause + scrollSeconds) / total) },
                { transform: `translateX(-${overflow}px)`, offset: 1 }
            ],
            { duration: total * 1000, iterations: Infinity, easing: "linear" }
        );
        return () => animation.cancel();
    }, [overflow, delaySeconds, pixelsPerSecond, endPauseSeconds]);

    const justify = overflow > 0
        ? "flex-start"
        : align === "center"
            ? "center"
            : align === "right"
                ? "flex-end"
                : "flex-start";

    return (
        <span
            ref={viewportRef}
            className={className}
            style={{
                display: "flex",
                width: "100%",
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                color,
                fontSize,
                fontWeight,
                lineHeight: 1.05,
                textTransform,
                letterSpacing,
                opacity,
                justifyContent: justify
            }}
        >
            <span ref={textRef} style={{ display: "inline-block", minWidth: "max-content" }}>
                {text}
            </span>
        </span>
    );
}
