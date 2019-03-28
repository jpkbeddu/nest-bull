import { flatten } from '@nestjs/common';
import { Injectable, Type } from '@nestjs/common/interfaces';
import { ModulesContainer } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { Module } from '@nestjs/core/injector/module';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { BullCoreModule } from '../../bull-core.module';
import { BULL_QUEUE_DECORATOR } from '../../bull.constants';
import {
  BullModuleOptions,
  BullQueue,
  BullQueueOptions,
} from '../../bull.interfaces';
import { getBullQueueToken } from '../../bull.utils';

export abstract class BaseExplorerService<Options> {
  constructor(
    protected readonly options: BullModuleOptions,
    protected readonly modulesContainer: ModulesContainer,
    protected readonly metadataScanner: MetadataScanner,
  ) {}

  protected getAllModules(): Module[] {
    return [...this.modulesContainer.values()];
  }
  protected getBullModule(modules: Module[]): Module {
    return modules.find(m => m.metatype === BullCoreModule)!;
  }

  public explore(): void {
    const modules = this.getAllModules();
    const bullModule = this.getBullModule(modules);

    const components = flatten(
      modules
        .filter(module => module.metatype !== BullCoreModule)
        .map(module => module.components),
    ) as Array<Map<string, InstanceWrapper<Injectable>>>;

    components.forEach(component => {
      for (const wrapper of component.values()) {
        if (
          wrapper.isNotMetatype ||
          !this.hasBullQueueDecorator(wrapper.metatype)
        ) {
          continue;
        }

        const metadata = Reflect.getMetadata(
          BULL_QUEUE_DECORATOR,
          wrapper.metatype,
        ) as BullQueueOptions;
        const bullQueueName = getBullQueueToken(metadata.name!);
        const bullQueueInstanceWrapper = this.getBullQueueProvider(
          bullModule,
          bullQueueName,
        );

        if (!bullQueueInstanceWrapper) {
          continue;
        }

        const bullQueue = bullQueueInstanceWrapper.instance as BullQueue;
        this.onBullQueueProcess(bullQueue, wrapper);
      }
    });
  }
  private getBullQueueProvider(
    bullModule: Module,
    bullQueueName: string,
  ): InstanceWrapper<Injectable> | undefined {
    for (const [name, instance] of bullModule.providers) {
      if (name === bullQueueName) {
        return instance;
      }
    }
  }
  private hasBullQueueDecorator(metatype: Type<Injectable>): boolean {
    return Reflect.hasMetadata(BULL_QUEUE_DECORATOR, metatype);
  }
  protected onBullQueueProcess(
    bullQueue: BullQueue,
    wrapper: InstanceWrapper<Injectable>,
  ) {
    const { instance } = wrapper;
    const prototype = Object.getPrototypeOf(instance);
    const propertyNames = this.metadataScanner
      .scanFromPrototype(instance, prototype, propertyName => {
        if (this.verifyPropertyName(prototype, propertyName)) {
          return propertyName;
        }
      })
      .filter(x => x) as string[];

    propertyNames.forEach(propertyName =>
      this.onBullQueuePropertyProcess(
        bullQueue,
        instance,
        prototype,
        propertyName,
        propertyNames,
      ),
    );
  }

  protected abstract onBullQueuePropertyProcess(
    bullQueue: BullQueue,
    instance: Injectable,
    prototype: any,
    propertyName: string,
    allPropertyNames?: string[],
  ): void;

  protected abstract verifyPropertyName(
    target: any,
    propertyName: string,
  ): boolean;

  protected abstract getOptions(prototype: any, propertyName: string): Options;
}
