export class LogLine {
    constructor(
        private dir: 'in' | 'out',
        private raw: string,
        private ts?: string
    ) {
        this.ts = ts || new Date().toISOString()
    }

    toJSON() {
        return {
            dir: this.dir,
            raw: this.raw,
            ts: this.ts
        }
    }

    toString() {
        return `${this.ts} ${this.dir} ${this.raw}`
    }
}
