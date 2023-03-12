import { Transform } from 'stream';

import {
    state as S,
    function as F,
} from 'fp-ts';

import * as u from '../utils/index.js';





export function strip_sni_trans () {

    let fn = (buf: Buffer) => {
        fn = F.identity;
        return strip_sni(buf);
    };

    /* Note:
        simplified implementation,
        expecting the Client Hello received in whole chunk for now.
    */
    return new Transform({

        transform (chunk: Buffer, _enc, cb) {
            cb(void 0, fn(chunk));
        },

    });

}





export function strip_sni (buf: Buffer): Buffer {
    try {
        return strip_sni_raw(buf);
    } catch {
        return buf;
    }
}





function strip_sni_raw (chunk: Buffer): Buffer {

    type Anchor = Readonly<{
        i: number;
        size: number;
        modify (fn: u.Fn<number>, buf: Buffer): void;
    }>;

    const debug = u.noop as ReturnType<typeof trace>;
    // const debug = trace(chunk, console.log);

    let i = 0;

    // ---------------------------------------------------------- Record Header

    debug('Record Header', i, 5);
    if (chunk.readUIntBE(i, 3) !== 0x16_03_01) {
        return chunk;
    }

    i += 3;

    const len_record = {
        i,
        size: chunk.readUIntBE(i, 2),
        modify (this, fn, buf) {
            buf.writeUIntBE(fn(this.size), this.i, 2);
        },
    } satisfies Anchor;

    i += 2;

    // ------------------------------------------------------- Handshake Header

    debug('Handshake Header', i, 1);
    if (chunk.readUIntBE(i, 1) !== 0x01) {
        return chunk;
    }

    i += 1;

    const len_handshake = {
        i,
        size: chunk.readUIntBE(i, 3),
        modify (this, fn, buf) {
            buf.writeUIntBE(fn(this.size), this.i, 3);
        },
    } satisfies Anchor;

    i += 3;

    // --------------------------------------------------------- Client Version

    {
        const n = chunk.readUIntBE(i, 2);
        debug('Client Version', i, 2);

        if (n < 0x301 || n > 0x303) {
            return chunk;
        }

        i += 2;
    }

    // ---------------------------------------------------------- Client Random

    debug('Client Random', i, 32);
    i += 32;

    // ------------------------------------------------------------- Session ID

    {
        const n = chunk.readUIntBE(i, 1) + 1;
        debug('Session ID', i + 1, n);
        i += n;
    }

    // ---------------------------------------------------------- Cipher Suites

    {
        const n = chunk.readUIntBE(i, 2) + 2;
        debug('Cipher Suites', i, n);
        i += n;
    }

    // ---------------------------------------------------- Compression Methods

    debug('Compression', i, 2);
    i += 2;

    // ------------------------------------------------------------- Extensions

    const len_extensions = {
        i,
        size: chunk.readUIntBE(i, 2),
        modify (this, fn, buf) {
            buf.writeUIntBE(fn(this.size), this.i, 2);
        },
        within (this, n) {
            return n < this.i + this.size;
        },
    } satisfies Anchor & { within: u.Fn<number, boolean> };

    i += 2;

    while (len_extensions.within(i)) {

        const { j, id, total } = ext(chunk, i);

        if (id === 0x00) { // -------------------------- Extension: Server Name

            debug('Server Name', i, total, b => b.toString('utf8', 9));

            const update = (buf: Buffer, a: number, b: number) => {

                const shrink = (m: number) => m - b;

                len_record.modify(shrink, buf);
                len_handshake.modify(shrink, buf);
                len_extensions.modify(shrink, buf);

                buf.copy(buf, a, a + b);

                return buf.subarray(0, shrink(buf.length));

            };

            return update(chunk, i, total);

        }

        i = j;

    }

    return chunk;

}





export function trace (chunk: Buffer, print: typeof console.log) {
    return function (
            name: string, l: number, h: number,
            fn = (b: Buffer) => b.toString('hex') as unknown,
    ) {
        print(
            name.padStart(20, '-') + ':',
            fn(chunk.subarray(l, l + h)),
        );
    };
}





const read = (buf: Buffer, n: number) => (i: number) => buf.readUIntBE(i, n);

const ext = (buf: Buffer, i: number) => F.pipe(

    S.of({}) as never,

    S.apS('id', S.gets(read(buf, 2))),
    S.apFirst(S.modify(u.std.Num.add(2))),

    S.apS('size', S.gets(read(buf, 2))),
    S.apFirst(S.modify(u.std.Num.add(2))),

    // id<2-byte> + size<2-byte> + size
    S.let('total', ({ size }) => 2 + 2 + size),

    S.bind('j', ({ size }) => S.gets(u.std.Num.add(size))),

    S.evaluate(i),

);

