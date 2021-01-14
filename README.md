# wabble

[![npm version](https://badgen.net/npm/v/@stableness/wabble)](https://www.npmjs.com/package/@stableness/wabble)
[![actions](https://github.com/stableness/wabble/workflows/Check/badge.svg)](https://github.com/stableness/wabble/actions)
[![codecov](https://codecov.io/gh/stableness/wabble/branch/master/graph/badge.svg)](https://codecov.io/gh/stableness/wabble)
[![vulnerabilities](https://snyk.io/test/npm/@stableness/wabble/badge.svg)](https://snyk.io/test/npm/@stableness/wabble) 





## Templates

- https://github.com/stableness/joggle ([create](https://github.com/stableness/joggle/generate), [download](https://github.com/stableness/joggle/archive/master.zip))





## `setting.yml`

```yaml
version: 1.0



api:
  port: 8080
  cors: false    # set true to enable Cross-Origin Resource Sharing
  shared: false  # set true to allow access from external



resolver:
  
  timeout: 80  # default as 80 milliseconds

  ttl:
    min: 3600   # minimum to 1 hour
    max: 86400  # maximum to 1 day

  list:
    - uri:   udp://1.1.1.1             # DNS
    - uri:   tls://1.1.1.1             # DNS over TLS   (DoT)
    - uri: https://1.1.1.1/dns-query   # DNS over HTTPS (DoH)



services: # local

  # http proxy
  - uri:   http://127.0.0.1:3000

  # socks5 proxy
  - uri: socks5://127.0.0.1:4000



servers: # remote, circular ordering (round-robin)

  # http
  - uri: http://example.org:3128

  # socks5
  - uri: socks5://example.org:1080

  # shadowsocks
  - uri: ss://example.org:4200
    key: this-is-your-password
    alg: aes-128-cfb # optional, default to chacha20-ietf-poly1305

  # trojan
  - uri: trojan://example.org:443
    password: 123456
    ssl: # optional, each fields default as below
      verify: true
      verify_hostname: true
      sni: example.org # default to the hostname in uri on above
      alpn: [ h2, http/1.1 ]
      cipher:
        - ECDHE-ECDSA-AES256-GCM-SHA384
        - ECDHE-ECDSA-CHACHA20-POLY1305
        - ECDHE-RSA-AES256-GCM-SHA384
        - ECDHE-RSA-CHACHA20-POLY1305
        - ECDHE-ECDSA-AES256-SHA
        - ECDHE-RSA-AES256-SHA
        - DHE-RSA-AES256-SHA
        - AES256-SHA
      cipher_tls13:
        - TLS_AES_128_GCM_SHA256
        - TLS_CHACHA20_POLY1305_SHA256
        - TLS_AES_256_GCM_SHA384



rules:

  proxy:

    # plain text match
    - google

    # prefix with: BEGIN, FULL, END, REG, CIDR,
    - BEGIN,admin.
    -  FULL,www.instagram.com
    -   END,youtube.com
    -   REG,(www|mobile)\.twitter\.com$
    -  CIDR,8.8.8.0/24

  direct:

    - END,.cn
    - FULL,localhost

  reject:

    # prepend with NOT to make sure it doesn't gets dropped accidentally
    - NOT,END,.org

    - safebrowsing.urlsec.qq.com

    - doubleclick
    - google-analytics
```





## API Endpoint

- `GET  /health`
- `GET  /metrics`
- `GET  /dump`
- `POST /test-domain`
- `POST /reload`
- `POST /exit`

