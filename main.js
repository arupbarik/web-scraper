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

const delay=(time)=>{
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
const max_page=Number(prompt("How many pages"));
const max_depth=Number(prompt("How mcuh depth"));

const all_url=[];
const error_logs=[];
const url_queue=[];    
const url_visited=[];
const selector_info=[];
const result=[];

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

while(1){
    if(choice==="n"){
        break;
    }
    else{
        const selectors={
            field:"",
            cssselector:""
        };
        selectors.field=prompt("Enter field title:").toLowerCase();
        selectors.cssselector=prompt("Enter its css selector to extract").toLowerCase();
        // selectors[field_name]=cssselector;

        console.log("what is the type of data");
        const extract_choice=prompt("links(l) or text (t) [be carefull sensitive to input!!]: ").toLowerCase();
        if(extract_choice==="l" || "links"){
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