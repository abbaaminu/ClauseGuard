declare module 'npm:@supabase/supabase-js@2' {
  export function createClient(...args: any[]): any;
}

declare module 'npm:zod@3.25.76' {
  export namespace z {
    type infer<T> = T;
  }

  export const z: {
    object: <T extends Record<string, any>>(shape: T) => any;
    string: () => any;
    enum: <T extends string[]>(values: readonly [...T]) => any;
    array: <T>(schema: T) => any;
  };
}

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(key: string): string | undefined;
  };
};
