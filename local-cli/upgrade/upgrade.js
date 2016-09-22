/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const chalk = require('chalk');
const shell = require('shelljs');
const semver = require('semver');
const Promise = require('promise');
const yeoman = require('yeoman-environment');
const generate = require('./generate').func;

/**
 * Promisify the callback-based shelljs function exec
 * @param command
 * @param opts
 * @returns {Promise}
 */
function exec(command, options) {
  return new Promise((resolve, reject) => {
    shell.exec(command, options || {}, (code, stdout) => {
      code
        ? reject(new Error('Command \'' + command + '\' exited with code ' + code))
        : resolve(stdout);
    })
  });
}

function checkDeclaredVersion(context) {
  if (!context.declaredVersion) {
    throw new Error(
      'Your \'package.json\' file doesn\'t seem to have \'react-native\' as a dependency.'
    );
  }
}

function checkMatchingVersions(context) {
  if (!semver.satisfies(context.currentVersion, context.declaredVersion)) {
    throw new Error(
      'react-native version in \'package.json\' doesn\'t match the installed version in \'node_modules\'.\n' +
      'Try running \'npm install\' to fix the issue.'
    );
  }
}

function checkReactPeerDependency(context) {
  if (semver.lt(context.currentVersion, '0.21.0') && !context.declaredReactVersion) {
    throw new Error(
      'Your \'package.json\' file doesn\'t seem to have \'react\' as a dependency.\n' +
      '\'react\' was changed from a dependency to a peer dependency in react-native v0.21.0.\n' +
      'Therefore, it\'s necessary to include \'react\' in your project\'s dependencies.\n' +
      'Just run \'npm install --save react\', then re-run \'react-native upgrade\'.\n'
    );
  }
}

function checkNewVersion(context, npmRegistryVersion) {
  const newVersion = semver.clean(npmRegistryVersion);
  if (!semver.valid(newVersion) && context.cliVersion) {
    throw new Error(
      'The specified version ' + context.cliVersion + ' doesn\'t exist.\n' +
      'Re-run the upgrade command with an existing version,\n' +
      'or without argument to upgrade to the latest: \'react-native upgrade\'.'
    );
  }

  return newVersion;
}

function configureGitEnv(context) {
  const tempRepositoryDir = path.resolve(os.tmpdir(), '.gitrn');
  process.env.GIT_DIR = tempRepositoryDir;
  process.env.GIT_WORK_TREE = '.';

  return tempRepositoryDir;
}

function runYeomanGenerators(context) {
  const env = yeoman.createEnv();

  const generatorPath = path.join(__dirname, '..', 'generator');
  env.register(generatorPath, 'react:app');
  const generatorArgs = ['react:app', context.appName].concat(context.cliArgs);
  return new Promise((resolve) => env.run(generatorArgs, {upgrade: true}, resolve));
}

function upgrade(args, config) {
  const installed = JSON.parse(fs.readFileSync('node_modules/react-native/package.json', 'utf8'));
  const pak = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const context = {
    appName: pak.name,
    currentVersion: installed.version,
    declaredVersion: pak.dependencies['react-native'],
    declaredReactVersion: pak.dependencies.react,
    cliVersion: (args && args.length) ? args[0] : null,
    cliArgs: args
  };

  return Promise.resolve(context)
    .then(() => checkDeclaredVersion(context))
    .then(() => checkMatchingVersions(context))
    .then(() => checkReactPeerDependency(context))
    .then(() => exec('npm view react-native@' + (context.cliVersion || 'latest') + ' version'))
    .then(output => {
      context.newVersion = checkNewVersion(context, output);
    })
    .then(() => {
      context.tempRepositoryDir = configureGitEnv(context);
    })
    .then(() => exec('git init'))
    .then(() => exec('git add .'))
    .then(() => exec('git commit -m "Project snapshot"'))
    .then(() => runYeomanGenerators(context))
    .then(() => exec('git add .'))
    .then(() => exec('git commit -m "Old version"'))
    .then(() => exec('npm install react-native@' + context.newVersion))
    .then(() => runYeomanGenerators(context))
    .then(() => exec('git add .'))
    .then(() => exec('git commit -m "New version"'))
    .then(() => exec('git diff HEAD~1 HEAD'))
    .done(arg => console.log('DONE', arg), arg => console.log('DONE WITH ERROR', arg));
}

module.exports = {
  name: 'upgrade',
  description: 'upgrade your app\'s template files to the latest version; run this after ' +
  'updating the react-native version in your package.json and running npm install',
  func: upgrade,
};
