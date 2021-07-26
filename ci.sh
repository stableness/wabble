#!/bin/sh

set -eu



prerelease()
{

    VER=$(jq -r '.version' package.json)
    PKG=package.json TMP=lite.json MODEL=src/model.ts

    sed -i "s#<%=VERSION=>#${VER}#g" ${MODEL}
    sed -i "s#<%=NODE_ENV=>#${NODE_ENV:-production}#g" ${MODEL}

    jq '.type="commonjs"' ${PKG} > ${TMP} && mv ${TMP} ${PKG}

}



release()
{
    curl -X PUT -sLo /dev/null https://npm.taobao.org/sync/$(jq -r '.name' package.json)?sync_upstream=true

    PKG=package.json VER=$(jq -r '.version' package.json) TMP=lite.json

    echo ::set-output name=ver::${VER}

    npm run -s bundle

    npm shrinkwrap && mv npm-shrinkwrap.json dist/shrinkwrap.json

    jq '{ name, version, bin, files }' ${PKG} > ${TMP} && mv ${TMP} ${PKG}

    npm pack && mv *.tgz dist/wabble-${VER}.tgz && cd dist/

    # npx nexe bin.cjs --target macos-x64-v12.13.1 --name macos-v${VER}-n12

    mkdir artifacts

    mv bin.cjs bin-${VER}.cjs
    mv bin-*.cjs *.json *.tgz artifacts/ && cd artifacts/

    CS=checksum.txt NT=notes.md

    sha256sum *[^.txt] > ${CS}
    echo '```' > ${NT}
    cat ${CS} >> ${NT}
    sha256sum ${CS} >> ${NT}
    echo '```' >> ${NT}

    ls -lh
}



cd $1 && shift && "$@"

