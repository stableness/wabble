import * as R from 'ramda';

import {
    taskEither as TE,
    string as Str,
    readonlyArray as A,
    function as F,
    predicate as P,
} from 'fp-ts';

import { option2B, Fn, std, type CurryT } from '../utils/index.js';





// :: number[] -> boolean
export const do_not_have_authentication = P.not(R.includes(0x02));





// :: Option -> boolean
export const do_not_require = P.not(option2B);





// :: (number -> TaskEither Error Buffer) -> TaskEither Error Buffer
export function readFrame (read: Fn<number, TE.TaskEither<Error, Buffer>>) {

    return F.pipe(
        read(1),
        TE.map(buffer => buffer.readUInt8(0)),
        TE.chain(read),
    );

}





export const date_to_dump_name: CurryT<[ string, Date, string ]>
= pid => F.flow(
    std.date.toISOString,
    std.Str.dropRight(5),
    std.Str.replaceAll ('-') (''),
    std.Str.replaceAll (':') (''),
    Str.split('T'),
    A.prepend('Heap'),
    A.append(pid),
    std.A.join('-'),
    std.Str.append('.heapsnapshot'),
);

