export type Database = {prepare(sql:string):{bind(...values:unknown[]):{all<T>():Promise<{results:T[]}>;run():Promise<{meta:{changes:number}}>}}};
