export function authDestination(value: string | undefined) {
 if(!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))return '/my-jobs';
 try {const u=new URL(value,'https://wrrcs.com');return u.origin==='https://wrrcs.com'?u.pathname+u.search+u.hash:'/my-jobs';}catch{return '/my-jobs';}
}
