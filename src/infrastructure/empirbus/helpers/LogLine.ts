export class LogLine {
    constructor(
        private dir: 'in' | 'out',
        private raw: string,
        private ts?: string
    ) {
        this.ts = ts || new Date().toISOString()
    }
}
