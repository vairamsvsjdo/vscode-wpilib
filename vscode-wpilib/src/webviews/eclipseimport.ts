'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { IPreferencesJson } from '../preferences';
import { generateCopyCpp, generateCopyJava, promisifyMkdirp } from '../shared/generator';
import { extensionContext, promisifyExists, promisifyReadFile, promisifyWriteFile } from '../utilities';
import { WebViewBase } from './webviewbase';

// tslint:disable-next-line:no-var-requires
const javaProperties = require('java-properties');

interface IImportProject {
  fromProps: string;
  toFolder: string;
  projectName: string;
  newFolder: boolean;
  teamNumber: string;
}

export class EclipseImport extends WebViewBase {
  public static async Create(resourceRoot: string): Promise<EclipseImport> {
    const cimport = new EclipseImport(resourceRoot);
    await cimport.asyncInitialize();
    return cimport;
  }

  private constructor(resourceRoot: string) {
    super('wpilibeclipseimport', 'WPILib Eclipse Import', resourceRoot);

    this.disposables.push(vscode.commands.registerCommand('wpilibcore.importEclipseProject', async () => {
      this.displayWebView(vscode.ViewColumn.Active, true, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      if (this.webview) {
        this.webview.webview.onDidReceiveMessage(async (data) => {
          // tslint:disable-next-line:no-unsafe-any
          switch (data.type) {
            case 'eclipse':
              await this.handleEclipseButton();
              break;
            case 'newproject':
              await this.handleNewProjectLoc();
              break;
            case 'importproject':
              // tslint:disable-next-line:no-unsafe-any
              await this.handleImport(data.data);
              break;
            default:
              break;
          }
        }, undefined, this.disposables);
      }
    }));
  }

  private async handleEclipseButton() {
    // Find old project
    const oldProject = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'eclipse-workspace')),
      filters: {
        'Eclipse Project': ['properties'],
      },
      openLabel: 'Select a Project',
    });

    if (oldProject === undefined || oldProject.length !== 1) {
      return;
    }

    const oldProjectPath = path.dirname(oldProject[0].fsPath);
    if (this.webview) {
      await this.webview.webview.postMessage({
        data: oldProject[0].fsPath,
        type: 'eclipse',
      });
      await this.webview.webview.postMessage({
        data: path.basename(oldProjectPath),
        type: 'projectname',
      });
    }
  }

  private async handleNewProjectLoc() {
    const open: vscode.OpenDialogOptions = {
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Folder',
    };
    const result = await vscode.window.showOpenDialog(open);

    if (result === undefined) {
      return;
    }

    if (this.webview) {
      await this.webview.webview.postMessage({
        data: result[0].fsPath,
        type: 'newproject',
      });
    }
  }

  private async handleImport(data: IImportProject) {
    const oldProjectPath = path.dirname(data.fromProps);

    const cpp = await promisifyExists(path.join(oldProjectPath, '.cproject'));

    // tslint:disable-next-line:no-unsafe-any
    const values = javaProperties.of(data.fromProps);

    // tslint:disable-next-line:no-unsafe-any
    const javaRobotClass: string = values.get('robot.class', '');

    let toFolder = data.toFolder;

    if (data.newFolder) {
      toFolder = path.join(data.toFolder, data.projectName);
    }

    try {
      await promisifyMkdirp(toFolder);
    } catch {
      //
    }

    const gradleBasePath = path.join(extensionContext.extensionPath, 'resources', 'gradle');

    let success = false;
    if (cpp) {
      const gradlePath = path.join(gradleBasePath, 'cpp');
      success = await generateCopyCpp(path.join(oldProjectPath, 'src'), gradlePath, toFolder, true);
    } else {
      const gradlePath = path.join(gradleBasePath, 'java');
      success = await generateCopyJava(path.join(oldProjectPath, 'src'), gradlePath, toFolder, javaRobotClass, '');
    }

    if (!success) {
      return;
    }

    const buildgradle = path.join(toFolder, 'build.gradle');

    await new Promise<void>((resolve, reject) => {
      fs.readFile(buildgradle, 'utf8', (err, dataIn) => {
        if (err) {
          resolve();
        } else {
          const dataOut = dataIn.replace(new RegExp('def includeSrcInIncludeRoot = false', 'g'), 'def includeSrcInIncludeRoot = true');
          fs.writeFile(buildgradle, dataOut, 'utf8', (err1) => {
            if (err1) {
              reject(err);
            } else {
              resolve();
            }
          });
        }
      });
    });

    const jsonFilePath = path.join(toFolder, '.wpilib', 'wpilib_preferences.json');

    const parsed = JSON.parse(await promisifyReadFile(jsonFilePath)) as IPreferencesJson;
    parsed.teamNumber = parseInt(data.teamNumber, 10);
    await promisifyWriteFile(jsonFilePath, JSON.stringify(parsed, null, 4));

    const openSelection = await vscode.window.showInformationMessage('Would you like to open the folder?',
      'Yes (Current Window)', 'Yes (New Window)', 'No');
    if (openSelection === undefined) {
      return;
    } else if (openSelection === 'Yes (Current Window)') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(toFolder), false);
    } else if (openSelection === 'Yes (New Window)') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(toFolder), true);
    } else {
      return;
    }
  }

  private async asyncInitialize() {
    await this.loadWebpage(path.join(extensionContext.extensionPath, 'resources', 'webviews', 'eclipseimport.html'),
      path.join(extensionContext.extensionPath, 'resources', 'webviews', 'eclipseimport.js'));
  }
}