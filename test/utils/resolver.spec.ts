import DNS from 'dns';

import nock from 'nock';

import {
    either as E,
} from 'fp-ts';

import {

    genDNS,
    genDoH,

} from '../../src/utils/resolver';

import {
    paths,
} from '../__helpers__';

import * as u from '../../src/utils/index';





jest.mock('dns');





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

        const results = await u.run(doh('example.com'));

        expect(E.isRight(results)).toBe(false);

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
