/**
 * @name NPM Test
 * @icon mdi:script-text
 * @description 
 * @area REG77
 * @npm random
 * @label 
 * @loglevel info
 */

const random=require("random");
ha.log(`Zufallszahl ist ${random.int(0,100)}`);
