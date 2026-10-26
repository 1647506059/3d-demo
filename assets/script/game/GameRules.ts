/** Engine-independent rules, shared by gameplay and regression checks. */
export const GRAVITY = 10;
export const MAX_LEVEL = 1000;

export function ammoForStage(targets: number, configured: number): number {
    return Math.max(3, Math.min(configured || 20, 12, Math.ceil(targets / 5) + 1));
}

export function starsForWin(used: number, budget: number): number {
    return used <= Math.ceil(budget * 0.4) ? 3 : used <= Math.ceil(budget * 0.7) ? 2 : 1;
}

export function launchVelocity(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, seconds: number) {
    return { x: (to.x - from.x) / seconds, y: (to.y - from.y) / seconds + GRAVITY * seconds / 2, z: (to.z - from.z) / seconds };
}
