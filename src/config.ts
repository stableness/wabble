import type { URL } from 'url';

import type { option as O } from 'fp-ts';

import type { ShadowSocks } from './settings/utils';





interface Base {

    protocol: 'socks5' | 'http' | 'https' | 'ss' | 'trojan';

    host: string;
    port: number;

    tags: Set<string>;

    attr?: Partial<{
        priority: string;
        fit: boolean;
        xit: boolean;
    }>;

}

export interface Socks5 extends Base {

    protocol: 'socks5';

}

export interface Http extends Base {

    protocol: 'http' | 'https';

    ssl: {
        verify: boolean;
    };

}

export interface Trojan extends Base {

    protocol: 'trojan';

    password: string;

    ssl: {
        verify: boolean;
        verify_hostname: boolean;
        sni?: string;
        alpn?: Array<string>;
        ciphers?: string;
    };

}

export interface ShadowSocks extends Base {

    protocol: 'ss';

    key: Buffer;

    cipher: Stream | AEAD;

}

interface Stream {

    type: 'Stream';

    algorithm: ShadowSocks.CipherType['Stream'];
    keySize: number;
    ivLength: number;

}

interface AEAD {

    type: 'AEAD';

    algorithm: ShadowSocks.CipherType['AEAD'];
    keySize: number;
    saltSize: number;
    nonceSize: number;
    tagSize: number;

}

export type Remote = Http | Socks5 | ShadowSocks | Trojan;





export type Basic = Pick<URL, 'username' | 'password'>;





export interface Service {

    protocol: 'socks5' | 'http';
    host: string;
    port: number;

    auth: O.Option<(info: Basic) => boolean>;

};





export interface Config {

    services: ReadonlyArray<Service>;

    doh: O.Option<string>;

    servers: ReadonlyArray<Remote>;

    rules: Record<'direct' | 'reject' | 'proxy', ReadonlyArray<string>>;

    sieve: Record<'direct' | 'reject', O.Option<string>>;

}

