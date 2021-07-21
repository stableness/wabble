import { URL } from 'url';

import type {
    option as O,
    readonlyNonEmptyArray as RNEA,
} from 'fp-ts';

import * as SS from './settings/utils/shadowsocks.js';

import { Fn } from './utils/index.js';





type RemoteProto = 'socks5' | 'http' | 'https' | 'ss' | 'trojan';

interface Base {

    protocol: RemoteProto;

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

    auth: O.Option<Basic>;

}

export interface Http extends Base {

    protocol: 'http' | 'https';

    auth: O.Option<string>;

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

    algorithm: SS.Stream;
    keySize: number;
    ivLength: number;

}

interface AEAD {

    type: 'AEAD';

    algorithm: SS.AEAD;
    keySize: number;
    saltSize: number;
    nonceSize: number;
    tagSize: number;

}

export type Remote = Http | Socks5 | ShadowSocks | Trojan;





export type Basic = Readonly<Record<'username' | 'password', string>>;





export interface Service {

    protocol: 'socks5' | 'http';
    host: string;
    port: number;

    auth: O.Option<(info: Basic) => boolean>;

}





export interface API {

    host: string;
    port: number;
    cors: boolean;
    shared: boolean;

}




export interface NSResolver {

    protocol: 'https' | 'udp' | 'tls';

    uri: URL;

}





export interface Config {

    services: RNEA.ReadonlyNonEmptyArray<Service>;

    resolver: {
        ttl: O.Option<{
            min: number;
            max: number;
            calc: Fn<number>;
        }>;
        upstream: O.Option<RNEA.ReadonlyNonEmptyArray<NSResolver>>;
        timeout: number;
    };

    api: O.Option<API>;

    servers: ReadonlyArray<Remote>;

    rules: Record<'direct' | 'reject' | 'proxy', ReadonlyArray<string>>;

    sieve: Record<'direct' | 'reject', O.Option<string>>;

}

