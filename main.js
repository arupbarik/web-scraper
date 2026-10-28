// hey lets start the project 
// import PromptSync from "prompt-sync";
import * as cheerio from 'cheerio';
import {URL} from 'node:url';
import * as fs from 'node:fs/promises';
const base="https://books.toscrape.com/";
const response=await fetch(base);
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
await fs.writeFile("json/data.json",book_title);

const links=[];
const booklinks=$('.product_pod h3 a').each((index,ele)=>{
    const link=$(ele).attr("href");
    let url=new URL(link,base)
    links.push(url.href);
});

await fs.writeFile("json/book_url.json",JSON.stringify(links,null,2));

