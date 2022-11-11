import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';

export default defineConfig(
    {
        input: [
            "./lib/index.ts",
            "./lib/store.ts",
            "./lib/utils.ts"
        ],
        output: {
            sourcemap: true,
            format: 'esm',
            dir: './dist'
        },
        plugins: [
            typescript({
                exclude: [
                    'test/*.ts',
                    'examples/**',
                    'rollup.config.ts'
                ]
            })
        ]
    }
);