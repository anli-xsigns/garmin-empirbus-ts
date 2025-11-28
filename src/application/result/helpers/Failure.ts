import { FailureCode } from './FailureCode'

export type Failure = {
    failedWith: FailureCode
    errors: string[]
    hasFailed: true
    succeeded: false
}

export const isFailure = (value: unknown): value is Failure =>
    typeof value === 'object' &&
    value !== null &&
    'failedWith' in value &&
    'errors' in value
