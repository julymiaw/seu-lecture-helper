import {expect,it} from 'vitest';
import {findCandidates,mode,ordered,classified,parseTitle} from '../src/candidates';
import {sample} from './helpers';
it('pairs exact lecture title and event times, regardless of row order',async()=>{
  const a={...await sample(),id:'online',title:'【线上】【艺术】同一讲座'},b={...a,id:'offline',title:'【线下】【艺术】同一讲座'};
  expect(findCandidates(b,[a,b]).map(a=>a.id)).toEqual(['offline','online']);
  expect(ordered([b,a],'online').map(a=>a.id)).toEqual(['online','offline']);expect(ordered([a,b],'offline')[0].id).toBe('offline');
  expect(findCandidates(a,[a,{...b,eventEnd:'another time'}])).toEqual([a]);
  expect(findCandidates(a,[a,{...b,title:'【线下】另一个讲座'}])).toEqual([a]);
});
it('does not arbitrarily choose among duplicate variants; requires valid manual classification',async()=>{
  const a={...await sample(),id:'a',title:'无场次标签'},b={...a,id:'b'};
  expect(mode(a)).toBeUndefined();expect(classified([a,b])).toBe(false);expect(classified([a,b],{a:'online',b:'offline'})).toBe(true);
  expect(classified([{...a,title:'【线上】讲座'}, {...b,title:'【线上】讲座'}])).toBe(false);
  expect(findCandidates(a,[a,b,{...b,id:'c'}])).toEqual([a]);
});

it('reads the first two brackets instead of matching mode words inside the name',async()=>{
  expect(parseTitle('【线上】【艺术】理解线下生活')).toEqual({mode:'online',category:'艺术',name:'理解线下生活'});
  expect(parseTitle('【线下】【法律】线上纠纷')).toEqual({mode:'offline',category:'法律',name:'线上纠纷'});
  expect(parseTitle('线上文化')).toEqual({name:'线上文化'});
  const a={...await sample(),title:'【线上】【艺术】同名讲座'},b={...a,id:'b',title:'【线下】【法律】同名讲座'};
  expect(findCandidates(a,[a,b])).toEqual([a]);
});
