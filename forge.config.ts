import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const signLocalWindowsFile = (filePath: string): void => {
  if (process.platform !== 'win32') {
    return;
  }

  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('scripts/sign-local-windows.ps1'),
      '-Path',
      filePath,
    ],
    { stdio: 'inherit' },
  );
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'assets/icon',
    name: 'SafeTwin',
    executableName: 'SafeTwin',
    win32metadata: {
      CompanyName: 'Elgittos',
      FileDescription: 'SafeTwin',
      OriginalFilename: 'SafeTwin.exe',
      ProductName: 'SafeTwin',
      InternalName: 'SafeTwin',
    },
  },
  rebuildConfig: {},
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      for (const outputPath of packageResult.outputPaths) {
        signLocalWindowsFile(path.join(outputPath, 'SafeTwin.exe'));
      }
    },
    postMake: async (_forgeConfig, makeResults) => {
      for (const result of makeResults) {
        for (const artifact of result.artifacts) {
          if (artifact.endsWith('.exe')) {
            signLocalWindowsFile(artifact);
          }
        }
      }

      return makeResults;
    },
  },
  makers: [
    new MakerSquirrel({
      name: 'SafeTwin',
      setupExe: 'SafeTwinSetup.exe',
      setupIcon: 'assets/icon.ico',
      loadingGif: 'assets/installing.gif',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
