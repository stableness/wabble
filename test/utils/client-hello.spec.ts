import { Buffer as Buf } from 'node:buffer';

import { Readable, Writable } from 'node:stream';

import {
    describe, test, expect, jest,
} from '@jest/globals';

import {
    either as E,
    taskEither as TE,
    function as F,
} from 'fp-ts';

import * as Dc from 'io-ts/lib/Decoder.js';

import { parse } from 'yaml';

import {
    paths,
} from '../__helpers__/index.js';

import * as u from '../../src/utils/index.js';

import {
    trace,
    strip_sni,
    strip_sni_trans,
} from '../../src/utils/client-hello.js';





const fixtures = paths(__dirname, '../__fixtures__');





describe('strip_sni', () => {

    test('striped sni from example', async () => {

        const sample = await u.std.TE.unsafeUnwrap(tls_client_hello);

        expect(strip_sni(sample.example_sni)).toStrictEqual(sample.example);

    });

    test('on sni client-hello buffer unchanged', async () => {

        const sample = await u.std.TE.unsafeUnwrap(tls_client_hello);

        expect(strip_sni(sample.v1_2)).toBe(sample.v1_2);

    });

    test.each([
        Buf.of(),
        Buf.of(1, 2, 3, 4),
        Buf.of(
            0x16, 0x03, 0x01, 0x02, 0x00, 0xff,
            0x00, 0x01, 0xfc, 0x03, 0x09, 0xff,
        ),
        Buf.of(
            0x16, 0x03, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01,
            0xfc, 0x03, 0x00, 0x79, 0x23, 0x00, 0x90, 0x8f,
        ),
        Buf.of(
            0x16, 0x03, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01,
            0xfc, 0x03, 0x04, 0x79, 0x23, 0x00, 0x90, 0x8f,
        ),
    ])('unchanged non CH: %#', buf => {
        expect(strip_sni(buf)).toBe(buf);
    });

});





describe('strip_sni_trans', () => {

    test('only tamper tls client-hello at first once', async () => {

        const sample = await u.std.TE.unsafeUnwrap(tls_client_hello);

        const end = Buf.allocUnsafe(10);

        const sink = [] as Buffer[];

        await u.pump(

            new Readable({
                read () {

                    this.push(sample.example_sni);
                    this.push(sample.example_sni);
                    this.push(end);
                    this.push(null);

                },
            }),

            strip_sni_trans(),

            new Writable({
                write (chunk: Buffer, _enc, cb) {

                    sink.push(chunk);
                    cb();

                },
            }),

        );

        expect(Buf.concat(sink)).toStrictEqual(Buf.concat([
            sample.example,
            sample.example_sni,
            end,
        ]));

    });

});





describe('trace', () => {

    const noop = jest.fn(u.noop);
    const utf8 = jest.fn(u.bufferToString);

    const mute = trace(Buf.of(1, 2, 3, 4, 5), noop);

    test('invoke', () => {

        expect(mute('default',  0, 3)).toBeUndefined();
        expect(mute('toString', 2, 4, utf8)).toBeUndefined();

        expect(utf8).toHaveBeenCalledWith(Buf.of(3, 4, 5));

        expect(noop).toHaveBeenCalledTimes(2);

    });

});





const read_str = u.readFileInStringOf('utf-8');

const p_yaml = E.tryCatchK(parse as u.Fn<string, unknown>, E.toError);

const p_client_hello = F.pipe(
    Dc.fromRefinement(Buf.isBuffer, 'Node.js Buffer'),
    Dc.refine(
        (buf): buf is Buffer => buf.readUIntBE(0, 3) === 0x16_03_01,
        'tls client hello',
    ),
);

const { decode } = Dc.struct({
    v1_2: p_client_hello,
    v1_2_sni: p_client_hello,
    v1_2_sni_padding: p_client_hello,
    example: p_client_hello,
    example_sni: p_client_hello,
});

const tls_client_hello = F.pipe(
    read_str(fixtures('files/tls_client_hello.yml')),
    TE.chainEitherK(p_yaml),
    TE.chainEitherKW(decode),
);

