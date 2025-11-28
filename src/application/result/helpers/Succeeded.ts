import { SucceededCode } from './SucceededCode'

export type Succeeded<T> = {
    hasFailed: false
    succeeded: true
    succeededWith: SucceededCode
    result: T
}
