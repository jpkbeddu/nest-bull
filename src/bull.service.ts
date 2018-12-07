import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as deepmerge from 'deepmerge';
import { BullConstants } from './bull.constants';
import {
  BullModuleOptions,
  BullQueue,
  BullQueueOptions,
  BullQueueProcessorOptions,
} from './bull.interfaces';
import { getBullQueueToken } from './bull.utils';

@Injectable()
export class BullService {
  constructor(
    @Inject(BullConstants.BULL_MODULE_OPTIONS)
    private bullModuleOptions: BullModuleOptions,
    private moduleRef: ModuleRef,
  ) {}

  public setupQueues() {
    const modules = this.getModules();

    const components: any[][] = modules.map(module =>
      this.getComponents(module),
    );

    for (const componentsInModule of components) {
      const bullQueueComponents = this.getBullQueueComponents(
        componentsInModule,
      );

      for (const bullQueueComponent of bullQueueComponents) {
        const { target, queueName, propertyKeys } = this.getBullQueueData(
          bullQueueComponent,
        );

        const providers = this.getBullQueueProviders(components, queueName);

        for (const provider of providers) {
          const queue = provider.instance;
          this.assignProcessors(
            target,
            this.getProcessors(target, propertyKeys),
            queue,
          );

          this.assignEvents(
            target,
            this.getEvents(target, propertyKeys),
            queue,
          );
        }
      }
    }
  }

  private assignEvents(
    target: object,
    events: { propertyKey: string; metadata: any }[],
    queue: BullQueue,
  ) {
    if (events.length === 0) {
      return;
    }

    for (const event of events) {
      for (const eventName of event.metadata) {
        queue.on(eventName, target[event.propertyKey].bind(target));
        Logger.log(
          `${eventName} listener on ${queue.name} initialized`,
          BullConstants.BULL_MODULE,
          true,
        );
      }
    }
  }

  private assignProcessors(
    target: object,
    processors: { propertyKey: string; metadata: any }[],
    queue: BullQueue,
  ): void {
    if (processors.length === 0) {
      return;
    }

    let isDefinedDefaultHandler: boolean = false;

    for (const processor of processors) {
      const processorOptions = this.createProcessorOptions(
        processor.propertyKey,
        processor.metadata,
      );

      queue.process(
        processorOptions.name,
        processorOptions.concurrency,
        target[processor.propertyKey].bind(target),
      );

      if (!isDefinedDefaultHandler) {
        queue.process(
          processorOptions.concurrency,
          target[processor.propertyKey].bind(target),
        );
        isDefinedDefaultHandler = true;
      }

      Logger.log(
        `${processorOptions.name} processor on ${queue.name} initialized`,
        BullConstants.BULL_MODULE,
        true,
      );
    }
  }

  private getBullQueueData(
    bullQueueComponent: any,
  ): { target: any; queueName: string; propertyKeys: string[] } {
    const target = bullQueueComponent.instance;
    const queueName = this.createBullQueueName(target, bullQueueComponent.name);
    const propertyKeys = Object.getOwnPropertyNames(
      bullQueueComponent.metatype.prototype,
    ).filter(key => key !== 'constructor') as string[];

    return { target, queueName, propertyKeys };
  }

  private getModules() {
    // @ts-ignore
    const modulesContainer = this.moduleRef.container.modulesContainer;
    return Array.from(Map.prototype.values.apply(modulesContainer));
  }

  private getComponents(module: any): any[] {
    return Array.from(Map.prototype.values.apply(module.components));
  }

  private getBullQueueProviders(components: any[][], queueName: string): any[] {
    const flatComponents = [].concat.apply([], components);
    return flatComponents
      .filter(
        component =>
          component &&
          component.instance !== undefined &&
          component.instance !== null &&
          typeof component.instance !== 'string',
      )
      .filter(component => {
        return component.name === getBullQueueToken(queueName);
      });
  }

  private getBullQueueComponents(components: any[]): any[] {
    return components
      .filter(
        component =>
          component &&
          component.instance !== undefined &&
          component.instance !== null &&
          typeof component.instance !== 'string',
      )
      .filter(component => {
        const metadataKeys = Reflect.getMetadataKeys(component.instance);
        return metadataKeys.indexOf(BullConstants.BULL_QUEUE_DECORATOR) !== -1;
      });
  }

  private createBullQueueName(target: any, className: string) {
    const queueMetadata: BullQueueOptions = Reflect.getMetadata(
      BullConstants.BULL_QUEUE_DECORATOR,
      target,
    );

    return queueMetadata.name || className;
  }

  private createProcessorOptions(
    propertyKey: string,
    processorOptions: BullQueueProcessorOptions,
  ): BullQueueProcessorOptions {
    return deepmerge.all([
      { name: propertyKey, concurrency: 1 },
      processorOptions === BullConstants.BULL_QUEUE_PROCESSOR_DECORATOR
        ? {}
        : processorOptions,
    ]) as BullQueueProcessorOptions;
  }

  private getEvents(
    target: any,
    propertyKeys: string[],
  ): { propertyKey: string; metadata: any }[] {
    return propertyKeys
      .map(propertyKey => {
        return {
          propertyKey,
          metadata: Reflect.getMetadata(
            BullConstants.BULL_QUEUE_EVENT_DECORATOR,
            target,
            propertyKey,
          ) as BullQueueProcessorOptions,
        };
      })
      .filter(o => {
        return o.metadata !== null && o.metadata !== undefined;
      });
  }

  private getProcessors(
    target: any,
    propertyKeys: string[],
  ): { propertyKey: string; metadata: any }[] {
    return propertyKeys
      .map(propertyKey => {
        return {
          propertyKey,
          metadata: Reflect.getMetadata(
            BullConstants.BULL_QUEUE_PROCESSOR_DECORATOR,
            target,
            propertyKey,
          ) as BullQueueProcessorOptions,
        };
      })
      .filter(o => {
        return o.metadata !== null && o.metadata !== undefined;
      });
  }
}