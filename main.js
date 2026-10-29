// hey lets start the project 
// import PromptSync from "prompt-sync";
import * as cheerio from 'cheerio';
import {URL} from 'node:url';
import * as fs from 'node:fs/promises';

async function fetch_bookurl(url) {

    const response=await fetch(url);
    if(!response.ok){
        throw new Error(`HTTP${response.status}:${url}`);
    }
    const data=await response.text();

    return data;
}

const delay=(time)=>{
    return new Promise ((resolve)=>{
        setTimeout(resolve,time);
    })
}

const base="https://books.toscrape.com/";
let data;
try {
    const response=await fetch(base);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${base}`);
    }
    data=await response.text();
} catch (error) {
    console.error(`type: ${error.name}
        message:${error.message}`);
    throw error;
}

const $=cheerio.load(data);
const bt=[];
$('.product_pod h3 a').each((index,ele)=>{
    const $ele=$(ele).attr("title");
    bt.push($ele)
});
// console.log(bt);
const book_title=JSON.stringify(bt,null,2);

await fs.writeFile("json/data.json",book_title);

const links=[];
$('.product_pod h3 a').each((index,ele)=>{
    const link=$(ele).attr("href");
    let url=new URL(link,base)
    links.push(url.href);
});

await fs.writeFile("json/book_url.json",JSON.stringify(links,null,2));

const book_details_arr=[];
const error_logs=[];
for(let urrl of links){
    try {
        const book_details={
           name:"",
           price:"",
           availability:""
        }
        let html=await fetch_bookurl(urrl);
        const $book_page=cheerio.load(html);

        book_details.name=$book_page('.col-sm-6.product_main h1').text().trim();
        book_details.availability= $book_page('.col-sm-6.product_main p.instock.availability').text().trim();
        book_details.price=$book_page('.col-sm-6.product_main p.price_color').text().trim();
        book_details_arr.push(book_details);
        // console.log(title);
        // console.log(price);
        // console.log(available);
    } catch (error) {
        const logs={
            type:"",
            msg:"",
            failed_url:""
        }
        logs.type=error.name;
        logs.msg=error.message;
        logs.failed_url=urrl;
        error_logs.push(logs);
    }
    await delay(2000)
}

await fs.writeFile("json/book_details.json",JSON.stringify(book_details_arr,null,2));
await fs.writeFile("json/logs.json",JSON.stringify(error_logs,null,2))
