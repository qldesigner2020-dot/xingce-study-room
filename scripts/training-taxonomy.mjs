export {VERSION,INSTITUTION_VERSION,SUBTYPES,CURRICULUM,LEGACY_LEAVES,text,classify} from './taxonomy-v2.mjs';
// Original tags stay identical to Obsidian. The selector disambiguates the
// common-knowledge current-affairs group from the political-theory group.
export const trainingGroup=(q,c)=>q.module==='常识判断'&&c.group==='时事政治'?'常识时政':c.group;
