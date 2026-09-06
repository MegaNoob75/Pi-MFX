/*
 * Decorative, pointer-transparent stomp-switch assembly shared by the live
 * Performance tiles and Theme Manager preview. Separate layers make the
 * washer, threaded bushing, actuator and optional LED ring read as actual
 * hardware instead of a single metallic circle.
 */

export default function MultiFXFootswitchGraphic({
    color
}: {
    color: string;
}) {
    return (
        <span
            className="mfx-footswitch-hardware"
            style={{ color }}
            aria-hidden="true"
        >
            <span className="mfx-footswitch-hardware__led-ring" />
            <span className="mfx-footswitch-hardware__washer" />
            <span className="mfx-footswitch-hardware__bushing" />
            <span className="mfx-footswitch-hardware__actuator" />
        </span>
    );
}

/**
 * Decorative arcade pushbutton used by the arcade performance style. The
 * button is a separate layer so a tall performance slot never turns into one
 * enormous pill-shaped button.
 */
export function MultiFXArcadeButtonGraphic({
    color
}: {
    color: string;
}) {
    return (
        <span
            className="mfx-arcade-hardware"
            style={{ color }}
            aria-hidden="true"
        >
            <span className="mfx-arcade-hardware__rim" />
            <span className="mfx-arcade-hardware__button" />
        </span>
    );
}
