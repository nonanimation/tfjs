/**
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {BackendTimer} from './backends/backend';
import {TensorInfo} from './kernel_registry';
import {DataId} from './tensor';
import {NamedTensorMap} from './tensor_types';
import {BackendValues, DataType} from './types';
import * as util from './util';
import {sizeFromShape} from './util';

export class Profiler {
  constructor(
      private backendTimer: BackendTimer,
      private dataReader: (dataId: DataId) => Promise<BackendValues>,
      private logger?: Logger) {
    if (logger == null) {
      this.logger = new Logger();
    }
  }

  profileKernel<T extends TensorInfo|TensorInfo[]>(
      kernelName: string, inputs: NamedTensorMap, f: () => T): T {
    let result: T;
    const holdResultWrapperFn = () => {
      result = f();
    };
    const timer = this.backendTimer.time(holdResultWrapperFn);

    const results: TensorInfo[] =
        (Array.isArray(result) ? result : [result]) as TensorInfo[];
    results.forEach(r => {
      // Dangling promise here because we don't want to propagate up
      // asynchronicity.
      this.dataReader(r.dataId).then(vals => {
        checkComputationForErrors(vals, r.dtype, kernelName);

        timer.then(timing => {
          let extraInfo = '';
          if (timing.getExtraProfileInfo != null) {
            extraInfo = timing.getExtraProfileInfo();
          }

          this.logger.logKernelProfile(
              kernelName, r, vals, timing.kernelMs, inputs, extraInfo);
        });
      });
    });

    return result;
  }
}

export function checkComputationForErrors(
    vals: BackendValues, dtype: DataType, kernelName: string): boolean {
  if (dtype !== 'float32') {
    // Only floating point computations will generate NaN values
    return false;
  }
  for (let i = 0; i < vals.length; i++) {
    const num = vals[i] as number;
    if (isNaN(num) || !isFinite(num)) {
      // Throwing custom exception so behavior is testable.
      console.warn(`Found ${num} in the result of '${kernelName}'`);
      return true;
    }
  }
  return false;
}

export class Logger {
  logKernelProfile(
      name: string, result: TensorInfo, vals: BackendValues, timeMs: number,
      inputs: NamedTensorMap, extraInfo?: string) {
    const time = util.rightPad(`${timeMs}ms`, 9);
    const paddedName = util.rightPad(name, 25);
    const rank = result.shape.length;
    const size = sizeFromShape(result.shape);
    const shape = util.rightPad(result.shape.toString(), 14);
    let inputShapesDescription = '';

    for (const name in inputs) {
      const inputShape = inputs[name].shape;
      const inputRank = inputShape.length;
      inputShapesDescription +=
          `${name}: ${inputRank}D ${inputRank > 0 ? inputShape : ''} `;
    }

    console.log(
        `%c${paddedName}\t%c${time}\t%c${rank}D ${shape}\t%c${size}\t%c${
            inputShapesDescription}\t%c${extraInfo}`,
        'font-weight:bold', 'color:red', 'color:blue', 'color: orange',
        'color: green', 'color: steelblue');
  }
}
