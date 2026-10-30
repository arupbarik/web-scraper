// hey lets start the project 
// import PromptSync from "prompt-sync";
import * as cheerio from 'cheerio';
import {URL} from 'node:url';
import * as fs from 'node:fs/promises';

async function fetch_url(url) {

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
let count=1;
const bt=[`page${count}`];
const next_link_queue=[];
const book_details_arr=[];
const error_logs=[];
const links=[];
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

await fs.mkdir("json",{recursive:true});
const $=cheerio.load(data);

//initial next data
let start_next=$('.next a').attr('href');
let nexturl=new URL(start_next,base);
next_link_queue.push(nexturl);


//stores titles of all books in each page
$('.product_pod h3 a').each((index,ele)=>{
    const $ele=$(ele).attr("title");
    bt.push($ele)
});
// console.log(bt);

//stores titles of all books links in each page
$('.product_pod h3 a').each((index,ele)=>{
    const link=$(ele).attr("href");
    let url=new URL(link,base)
    links.push(url.href);
});

while(1){
    const html=await fetch_url(nexturl.href);
    const $page=cheerio.load(html);

    //stores titles of all books in each page
    count+=1;
    bt.push(`page${count}`);
    $page('.product_pod h3 a').each((index,ele)=>{
    const $ele=$page(ele).attr("title");
    bt.push($ele);
});

    //storing next urls
    start_next=$page('.next a').attr('href');
    if(start_next===undefined){break;}
    nexturl=new URL(start_next,nexturl);
    next_link_queue.push(nexturl.href);

    //stores titles of all books links in each page
    $page('.product_pod h3 a').each((index,ele)=>{
    const link=$page(ele).attr("href");
    let url=new URL(link,nexturl)
    links.push(url.href);
});
}

//storing all books title,price and availability of each page 
for(let urrl of links){
    try {
        const book_details={
           name:"",
           price:"",
           availability:""
        }
        console.log(`Processing: ${urrl}`);
        let html=await fetch_url(urrl);
        const $book_page=cheerio.load(html);

        book_details.name=$book_page('.col-sm-6.product_main h1').text().trim();
        book_details.availability= $book_page('.col-sm-6.product_main p.instock.availability').text().trim();
        book_details.price=$book_page('.col-sm-6.product_main p.price_color').text().trim();
        book_details_arr.push(book_details);
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
    await delay(500)
}

//store all data
await fs.writeFile("json/book_details.json",JSON.stringify(book_details_arr,null,2));
await fs.writeFile("json/book_url.json",JSON.stringify(links,null,2));
await fs.writeFile("json/data.json",JSON.stringify(bt,null,2));
await fs.writeFile("json/logs.json",JSON.stringify(error_logs,null,2));
await fs.writeFile("json/next_page_urls.json",JSON.stringify(next_link_queue,null,2));

