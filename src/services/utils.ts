import * as R from 'ramda';

import {
    either as E,
    taskEither as TE,
    function as F,
} from 'fp-ts';

import type { Read } from 'async-readable';

import { option2B, tryCatchToError } from '../utils';





// :: number[] -> boolean
export const do_not_have_authentication = R.complement(R.includes(0x02));





// :: Option -> boolean
export const do_not_require = R.complement(option2B);





// :: (number -> Promise Buffer) -> TaskEither Error Buffer
export function readFrame (read: Read) {

    const readTask = readToTaskEither(read);

    return F.pipe(
        readTask(1),
        TE.map(buffer => buffer.readUInt8(0)),
        TE.chain(readTask),
    );

}





// :: (number -> Promise Buffer) -> number -> TaskEither Error Buffer
export function readToTaskEither (read: Read) {

    return function (size: number) {

        return tryCatchToError(() => read(size));

    };

}





// :: TaskEither Error a -> Promise a
export async function unwrapTaskEither <A> (task: TE.TaskEither<Error, A>) {

    const result = await task();

    if (E.isRight(result)) {
        return result.right;
    }

    throw result.left;

}

