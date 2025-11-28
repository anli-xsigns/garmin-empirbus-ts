import { FailureCode } from './helpers/FailureCode'
import { Failure } from './helpers/Failure'
import { Succeeded } from './helpers/Succeeded'
import { SucceededCode } from './helpers/SucceededCode'

export type ResultType<T> = Succeeded<T> | Failure

export class Result {

    public static succeeded<T>(succeededCode: SucceededCode, result: T): Succeeded<T> {
        return {
            result: result,
            hasFailed: false,
            succeeded: true,
            succeededWith: succeededCode
        }
    }

    public static failed(failedWith: FailureCode, errors: string | string[]): Failure {
        return {
            failedWith,
            errors: Array.isArray(errors) ? errors : [errors],
            hasFailed: true,
            succeeded: false,
        }
    }
}
