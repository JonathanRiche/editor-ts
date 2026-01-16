declare module 'sqlocal' {
  export class SQLocal {
    constructor(databaseName: string);
    sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Array<Record<string, unknown>>>;
  }
}
