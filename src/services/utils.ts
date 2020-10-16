import * as R from 'ramda';

import {
    taskEither as TE,
    function as F,
} from 'fp-ts';

import type { Read } from 'async-readable';

import { option2B, readToTaskEither } from '../utils';





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

