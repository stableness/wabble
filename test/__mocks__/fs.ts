const fs = jest.createMockFromModule<typeof import('fs')>('fs');





let files: Record<string, string> = {} as never;

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
fs.__setMockFiles = (mapping: Record<string, string>) => {
    files = mapping;
};





fs.promises = {

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/require-await
    async readFile (filename: string, encoding?: string) {

        if (Boolean(filename) && filename in files) {

            const content = Buffer.from(files[filename] as string);

            if (encoding != null) {
                return content.toString(encoding);
            }

            return content;

        }

        throw new Error('404');

    },

};





module.exports = fs;
export default fs;

