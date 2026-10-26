/** Engine-independent rules, shared by gameplay and regression checks. */
export const GRAVITY = 10;
export const MAX_LEVEL = 1000;
export const FINAL_IMPACT_VIEW_TIME = 4;
export const FINAL_QUIET_TIME = 2.8;

/** Allow the hit, falling bodies and debris to play before a modal or another shot. */
export function canResolveShot(elapsed: number, quiet: number, pending: boolean, moving: boolean, terminal: boolean): boolean {
    if (pending || elapsed < (terminal ? FINAL_IMPACT_VIEW_TIME : 2.2) || quiet < (terminal ? FINAL_QUIET_TIME : 0.9)) return false;
    return !moving || elapsed >= 7;
}

export function ammoForStage(targets: number, configured: number): number {
    return Math.max(3, Math.min(configured || 20, 12, Math.ceil(targets / 5) + 1));
}

export function starsForWin(used: number, budget: number): number {
    return used <= Math.ceil(budget * 0.4) ? 3 : used <= Math.ceil(budget * 0.7) ? 2 : 1;
}

export function launchVelocity(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, seconds: number) {
    return { x: (to.x - from.x) / seconds, y: (to.y - from.y) / seconds + GRAVITY * seconds / 2, z: (to.z - from.z) / seconds };
}
