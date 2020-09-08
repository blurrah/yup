import isAbsent from './util/isAbsent';
import isSchema from './util/isSchema';
import printValue from './util/printValue';
import MixedSchema from './mixed';
import { array as locale } from './locale';
import runTests, { RunTest } from './util/runTests';
import { SchemaInnerTypeDescription } from './Schema';
import { InternalOptions, Callback, Message, Maybe } from './types';
import ValidationError from './ValidationError';
import Reference from './Reference';
import {
  Asserts,
  ResolveInput,
  ResolveOutput,
  SetNullability,
  SetPresence,
  TypeDef,
  TypeOf,
} from './util/types';

type RefectorFn = (value: any, index: number, array: any[]) => boolean;

export function create<TInner extends MixedSchema = MixedSchema>(
  type?: TInner,
) {
  return new ArraySchema(type);
}

type Type<T extends MixedSchema> = T extends MixedSchema<infer TType>
  ? TType
  : never;

export default class ArraySchema<
  T extends MixedSchema = MixedSchema,
  TDef extends TypeDef = 'optional' | 'nonnullable',
  TDefault extends Maybe<Maybe<Type<T>>[]> = undefined
> extends MixedSchema<
  Type<T>[],
  TDef,
  TDefault,
  ResolveInput<TypeOf<T>[], TDef, TDefault>,
  ResolveOutput<Asserts<T>[], TDef, TDefault>
> {
  //

  private _subType?: T;

  innerType: T | undefined;

  constructor(type?: T) {
    super({ type: 'array' });

    // `undefined` specifically means uninitialized, as opposed to
    // "no subtype"
    this._subType = type;
    this.innerType = type;

    this.withMutation(() => {
      this.transform(function (values) {
        if (typeof values === 'string')
          try {
            values = JSON.parse(values);
          } catch (err) {
            values = null;
          }

        return this.isType(values) ? values : null;
      });
    });
  }

  protected _typeCheck(v: any): v is any[] {
    return Array.isArray(v);
  }

  protected _cast(_value: any, _opts: InternalOptions) {
    const value = super._cast(_value, _opts);

    //should ignore nulls here
    if (!this._typeCheck(value) || !this.innerType) return value;

    let isChanged = false;
    const castArray = value.map((v, idx) => {
      const castElement = this.innerType!.cast(v, {
        ..._opts,
        path: `${_opts.path || ''}[${idx}]`,
      });
      if (castElement !== v) {
        isChanged = true;
      }

      return castElement;
    });

    return isChanged ? castArray : value;
  }

  protected _validate(
    _value: any,
    options: InternalOptions = {},
    callback: Callback,
  ) {
    let errors = [] as ValidationError[];
    let sync = options.sync;
    let path = options.path;
    let innerType = this.innerType;
    let endEarly = options.abortEarly ?? this.spec.abortEarly;
    let recursive = options.recursive ?? this.spec.recursive;

    let originalValue =
      options.originalValue != null ? options.originalValue : _value;

    super._validate(_value, options, (err, value) => {
      if (err) {
        if (!ValidationError.isError(err) || endEarly) {
          return void callback(err, value);
        }
        errors.push(err);
      }

      if (!recursive || !innerType || !this._typeCheck(value)) {
        callback(errors[0] || null, value);
        return;
      }

      originalValue = originalValue || value;

      // #950 Ensure that sparse array empty slots are validated
      let tests: RunTest[] = new Array(value.length);
      for (let idx = 0; idx < value.length; idx++) {
        let item = value[idx];
        let path = `${options.path || ''}[${idx}]`;

        // object._validate note for isStrict explanation
        let innerOptions = {
          ...options,
          path,
          strict: true,
          parent: value,
          index: idx,
          originalValue: originalValue[idx],
        };

        tests[idx] = (_, cb) =>
          innerType!.validate(
            item,
            innerOptions,
            // @ts-expect-error
            cb,
          );
      }

      runTests(
        {
          sync,
          path,
          value,
          errors,
          endEarly,
          tests,
        },
        callback,
      );
    });
  }

  _isPresent(value: any[]) {
    return super._isPresent(value) && value.length > 0;
  }

  of<TInner extends MixedSchema>(
    schema: TInner | false,
  ): ArraySchema<TInner, TDef, TDefault> {
    // FIXME: this should return a new instance of array without the default to be
    var next = this.clone();

    if (schema !== false && !isSchema(schema))
      throw new TypeError(
        '`array.of()` sub-schema must be a valid yup schema, or `false` to negate a current sub-schema. ' +
          'not: ' +
          printValue(schema),
      );
    // FIXME(ts):
    next._subType = schema as any;
    next.innerType = schema as any;

    return next as any;
  }

  min(min: number | Reference, message?: Message<{ min: number }>) {
    message = message || locale.min;

    return this.test({
      message,
      name: 'min',
      exclusive: true,
      params: { min },
      // FIXME(ts): Array<typeof T>
      test(value: any[]) {
        return isAbsent(value) || value.length >= this.resolve(min);
      },
    });
  }

  max(max: number | Reference, message?: Message<{ max: number }>) {
    message = message || locale.max;
    return this.test({
      message,
      name: 'max',
      exclusive: true,
      params: { max },
      // FIXME(ts): Array<typeof T>
      test(value: any[]) {
        return isAbsent(value) || value.length <= this.resolve(max);
      },
    });
  }

  ensure() {
    return this.default(() => [] as Type<T>[]).transform((val, original) => {
      // We don't want to return `null` for nullable schema
      if (this._typeCheck(val)) return val;
      return original == null ? [] : [].concat(original);
    });
  }

  compact(rejector?: RefectorFn) {
    let reject: RefectorFn = !rejector
      ? (v) => !!v
      : (v, i, a) => !rejector(v, i, a);

    return this.transform((values: any[]) =>
      values != null ? values.filter(reject) : values,
    );
  }

  describe() {
    let base = super.describe() as SchemaInnerTypeDescription;
    if (this.innerType) base.innerType = this.innerType.describe();
    return base;
  }
}

export default interface ArraySchema<
  T extends MixedSchema,
  TDef extends TypeDef,
  TDefault extends Maybe<Maybe<Type<T>>[]>
> extends MixedSchema<
    Type<T>[],
    TDef,
    TDefault,
    ResolveInput<TypeOf<T>[], TDef, TDefault>,
    ResolveOutput<Asserts<T>[], TDef, TDefault>
  > {
  default(): TDefault;
  default<TNext extends any[] = any[]>(
    def: TNext | (() => TNext),
  ): ArraySchema<T, TDef, TNext>;

  required(): ArraySchema<T, SetPresence<TDef, 'required'>, TDefault>;
  notRequired(): ArraySchema<T, SetPresence<TDef, 'optional'>, TDefault>;

  nullable(
    isNullable?: true,
  ): ArraySchema<T, SetNullability<TDef, 'nullable'>, TDefault>;
  nullable(
    isNullable: false,
  ): ArraySchema<T, SetNullability<TDef, 'nonnullable'>, TDefault>;
}
