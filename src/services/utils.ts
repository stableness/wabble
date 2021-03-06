import * as R from 'ramda';

import {
    taskEither as TE,
    function as F,
} from 'fp-ts';

import { option2B, Fn } from '../utils/index';





// :: number[] -> boolean
export const do_not_have_authentication = F.not(R.includes(0x02));





// :: Option -> boolean
export const do_not_require = F.not(option2B);





// :: (number -> TaskEither Error Buffer) -> TaskEither Error Buffer
export function readFrame (read: Fn<number, TE.TaskEither<Error, Buffer>>) {

    return F.pipe(
        read(1),
        TE.map(buffer => buffer.readUInt8(0)),
        TE.chain(read),
    );

}

