import DNS from 'dns';
import tls from 'tls';
import { Duplex } from 'stream';

import nock from 'nock';

import {
    either as E,
} from 'fp-ts';

import * as R from 'ramda';

import {

    genDNS,
    genDoH,
    genDoT,

} from '../../src/utils/resolver';

import {
    paths,
} from '../__helpers__';

import * as u from '../../src/utils/index';





jest.mock('dns');



jest.mock('tls', () => ({

    connect: jest.fn(),

}));





describe('genDoH', () => {

    const CF_DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

    test('invalid endpoint', async () => {

        const doh = genDoH('waaaaaaaaaaaaaaaaat');

        const results = await u.run(doh('example.com'));

        expect(E.isLeft(results)).toBe(true);

    });

    test('invalid path', async () => {

        const doh = genDoH(CF_DOH_ENDPOINT, 'waaaaaaaaaaaaaaaaat');

        const results = await u.run(doh('example.com'));

        expect(E.isLeft(results)).toBe(true);

    });

    test('valid', async () => {

        nock.load(fixtures('doh/valid.json'));

        const doh = genDoH(CF_DOH_ENDPOINT);

        const results = await u.run(doh('example.com'));

        expect(E.isRight(results)).toBe(true);

    });

    test('empty', async () => {

        nock.load(fixtures('doh/empty.json'));

        const doh = genDoH(CF_DOH_ENDPOINT);

        const results = await u.run(doh('waaaaaaaaaaaaaaaaat.com'));

        expect(E.isRight(results)).toBe(false);

    });

});





describe('genDoT', () => {

    const connect = tls.connect as jest.Mock;

    class MockSocket extends Duplex {

        constructor (res: Buffer) {

            super({

                read: u.noop,

                write (_chunk, _enc, cb) {
                    send();
                    cb();
                },

            });

            const send = R.once(() => this.push(res));

        }

        authorized = true;

        getPeerCertificate () {
            return Buffer.of(0);
        }

    }

    beforeEach(() => {
        connect.mockRestore();
    });

    afterAll(() => {
        jest.clearAllMocks();
    });

    const decode = function (str: string) {

        const buf = Buffer.from(u.str2arr(str).join(''), 'hex');
        const content = Buffer.alloc(buf.readUInt16BE(0) + 2);

        buf.copy(content);

        return content;

    };

    test('valid', async () => {

        connect.mockImplementationOnce((_opts, cb: () => void) => {

            setImmediate(cb);

            return new MockSocket(decode(`01d4
                000181800001000100000001076578616d706c6503636f6d0000010001c0
                0c000100010001116500045db8d82200002904d000000000019c000c0198
            `));

        });

        const dot = genDoT({ hostname: '1.1.1.1' });

        const results = await u.run(dot('example.com', { id: 1 }));

        expect(E.isRight(results)).toBe(true);

    });

    test('empty', async () => {

        connect.mockImplementationOnce((_opts, cb: () => void) => {

            setImmediate(cb);

            return new MockSocket(decode(`01d4
                0001818300010000000100011377616161616161616161616161616161616
                17403636f6d0000010001c0200006000100000384003d01610c67746c642d
                73657276657273036e657400056e73746c640c766572697369676e2d67727
                3c02060007ee2000007080000038400093a800001518000002904d0000000
                000157000c0153
            `));

        });

        const dot = genDoT({ hostname: '1.1.1.1' });

        const results = await u.run(dot('waaaaaaaaaaaaaaaaat.com', { id: 1 }));

        expect(results).toStrictEqual(E.left(new Error('empty result')));

    });

    test('invalid path', async () => {

        const dot = genDoT({ hostname: '1.1.1.1' }, 'waaaaaaaaaaaaaaaaat');

        const results = await u.run(dot('example.com'));

        expect(E.isLeft(results)).toBe(true);

    });

});





describe('genDNS', () => {

    const setServers = jest.fn();
    const resolve4 = jest.fn();



    beforeAll(() => {

        DNS.promises = {

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            Resolver: function () {
                return {
                    setServers,
                    resolve4,
                };
            },

        };

    });

    beforeEach(() => {
        setServers.mockRestore();
        resolve4.mockReset();
    });

    afterAll(() => {
        jest.clearAllMocks();
    });



    test.each([

        [                             ],
        [            'not ip address' ],
        [ '1.1.1.1', 'not ip address' ],

    ])('invalid resolver [ %s, %s ]', async (...list) => {

        setServers.mockImplementationOnce(() => {
            throw new Error('invalid ips');
        });

        const dns = genDNS(list);

        const results = await u.run(dns('example.com'));

        expect(resolve4).not.toHaveBeenCalled();
        expect(E.isLeft(results)).toBe(true);

    });

    test('empty result', async () => {

        const dns = genDNS('1.1.1.1');

        resolve4.mockResolvedValueOnce([]);

        const results = await u.run(dns('example.com'));

        expect(results).toStrictEqual(E.left(new Error('empty result')));

    });

    test('normal result', async () => {

        const dns = genDNS('1.1.1.1');

        const entries = [
            { address: '127.0.0.1', ttl: 42 },
        ];

        resolve4.mockResolvedValueOnce(entries);

        const results = await u.run(dns('example.com'));

        expect(results).toStrictEqual(E.right(entries));

    });

});





const fixtures = paths(__dirname, '../__fixtures__');
