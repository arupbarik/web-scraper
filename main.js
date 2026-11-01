// hey lets start the project 
import PromptSync from "prompt-sync";
import * as cheerio from 'cheerio';
import {URL} from 'node:url';
import * as fs from 'node:fs/promises';
import robotsParser from "robots-parser";

const prompt=PromptSync();

async function fetch_url(url) {
    const response=await fetch(url);

    if(!response.ok){
        throw new Error(`HTTP${response.status}:${url}`);
    }

    const data=await response.text();
    return data;
}

const delay=(time=100)=>{
    return new Promise ((resolve)=>{
        setTimeout(resolve,time);
    })
}

function links_extractor(html,selector,base){
    const $=cheerio.load(html);
    const links=[];
    $(selector).each((i,el)=>{
        const link=$(el).attr('href');
        const url=new URL(link,base)
        links.push(url.href);
    });
    return links;
}

function extractor(html,slector){
    const $=cheerio.load(html);
    const data=[];
    $(slector).each((i,el)=>{
        data.push($(el).text());
    })
    return data;
}

function queue(arr,robot){
    const url_queue=[];
    for(let targeturl of arr){
        const allowed=robot.isAllowed(targeturl,USER_AGENT);
        if(allowed===true){
            url_queue.push(targeturl);
        }
    }
    return url_queue;
}
 
async function getrobot(base){
    const origin=new URL(base).origin;
    const roboturl=new URL("robots.txt",origin).href;

    const response=await fetch(roboturl,{
        headers:
        {"User-Agent": USER_AGENT}
    });

    if (response.status === 404) {
        return robotsParser(roboturl, "");
    }
    
    if (!response.ok) {
        throw new Error(
            `Unable to retrieve robots.txt: ${response.status}`
        );
    }
    const robottext= await response.text();
    return robotsParser(roboturl,robottext);
}

//base link and declare require variables
const base=prompt("Enter your url:").toLowerCase();
let max_page;
let max_depth;
while(1){
    max_page=Number(prompt("How many pages"));
    max_depth=Number(prompt("How mcuh depth"));

    if(max_depth || max_page <0){
        console.log("cant be negative please retry!");
    }
    else{
        break;
    }
}

const all_url=[];
const error_logs=[];  //result/logs.json
const url_queue=[];   //result/all_eligible_urls.json    
const url_visited=[];  //result/extracted_data_urls.json
const selector_info=[];
const result=[];   //result/data.json
let depth=0;

//it is a crawler identity
const USER_AGENT = "web-scraper"; 

//robots .txt fetching
const robot=await getrobot(base);
const reqdelay=robot.getCrawlDelay(USER_AGENT);

//fetching the base url and extracting that page link
try {
    const html=await fetch_url(base);
    all_url.push(links_extractor(html,"a",base));
    
    //sorting all eligible urls
    const sort=queue(all_url,robot);
    url_queue.push(sort);
    all_url.length=0;
     
    // console.log("page is fetched and all available linked are fetched");

} catch (error) {
    const logs={
        type:"",
        msg:"",
        failed_url:""
    }
    logs.type=error.name;
    logs.msg=error.message;
    logs.failed_url=base;
    error_logs.push(logs);
    console.error(error.message);
}

// now collect all neceesary data from user
console.log("Do you want specific selector data or just generic information (eg. title,all headings,and paragraphs etc.)");
const choice=prompt("y or n:").toLowerCase();

if (choice==="y") {
    while(1){
        const selectors={
            field:"",
            cssselector:""
        };
        selectors.field=prompt("Enter field title:").toLowerCase();
        selectors.cssselector=prompt("Enter its css selector to extract").toLowerCase();
        // selectors[field_name]=cssselector;

        console.log("what is the type of data");
        const extract_choice=prompt("links(l) or text (t) [be carefull sensitive to input!!]: ").toLowerCase();
        if(extract_choice===("l" || "links")){
            // use links_extractor()
            const key="type";
            selectors[key]="link";
            selector_info.push(selectors);
        }
        else{
            // use extractor()
            const key="type";
            selectors[key]="text";
            selector_info.push(selectors);
        }

        const continuation_choice=prompt("do you want to add more fields y or n:").toLowerCase();
        if(continuation_choice==="n"){
            break;
        }
    }
}
else {
    //general extraction
}

//discover all links according to depth
try {
    let temp=url_queue;
    while(depth!=max_depth+1){
        const queue_length=url_queue.length;
        for(let url of temp){
            const html =await fetch_url(url);
            all_url.push(links_extractor(html,"a",url));
            url_queue.push(queue(all_url,robot));
            await delay(reqdelay);
        }
        const count=queue_length-url_queue.length;
        temp=url_queue.slice(queue_length,count);
        depth++;
    }
} catch (error) {
    const logs={
        type:"",
        msg:"",
        failed_url:""
    }
    logs.type=error.name;
    logs.msg=error.message;
    logs.failed_url=base;
    error_logs.push(logs);
    console.error(error.message);
}

//queue based fetching
try {
    let count=url_queue.length-max_page;
    url_queue.splice(-count,count);

} catch (error) {
    const logs={
        type:"",
        msg:"",
        failed_url:""
    }
    logs.type=error.name;
    logs.msg=error.message;
    logs.failed_url=base;
    error_logs.push(logs);
    console.error(error.message);
}
