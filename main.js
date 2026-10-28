// hey lets start the project 
// import PromptSync from "prompt-sync";
import * as cheerio from 'cheerio';
// import {URL} from 'node:url';
import * as fs from 'node:fs/promises';
const url="https://books.toscrape.com/";
const response=await fetch(url);
const data=await response.text();
const $=cheerio.load(data);
const title=$('title').text();
const bt=[];
const boo=$('.product_pod h3 a').each((index,ele)=>{
    const $ele=$(ele).attr("title");
    bt.push($ele)
});
console.log(bt);
const book_title=JSON.stringify(bt,null,2);
await fs.writeFile("data.json",book_title);
