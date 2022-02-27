'use strict';

import express from 'express';
import fetch from "node-fetch";
import { promises as fsp } from 'fs';
import https from 'node:https';
import { exec } from 'child_process';

// Constants
const PORT = 3000;
const HOST = '0.0.0.0';

// App
const app = express();

function execShellCommand(cmd, stdin) {
	return new Promise((resolve, reject) => {
	 const proc = exec(cmd, (error, stdout, stderr) => {
	  if (error) {
	   console.warn(error);
	   reject(`error during dia: ${stderr} ${stdout}`)
	  }
	  resolve(stdout? stdout : stderr);
	 });

	 proc.stdin.write(stdin)
	 proc.stdin.end();
	});
}

function fetch_wrap(backend) {
	return fetch(backend).then((res) => {
        if (!res.ok) {
			//console.log(res);
            throw Error(res.statusText);
        }
		
		return res.json().then((json) => {
			//console.log(json);
			return {
				"id": backend,
				"message": "OK",
				...json
			};
		});
	}).catch((error) => {
		console.log(error);
		return {
			"id": backend,
			"role": "error",
			"ip": "error",
			"node": "error",
			"message": error
		};
	});
}

// curl --cacert /run/secrets/kubernetes.io/serviceaccount/ca.crt -H "Authorization: Bearer `cat /run/secrets/kubernetes.io/serviceaccount/token`" https://kubernetes.default.svc/api/v1/namespaces/`cat /run/secrets/kubernetes.io/serviceaccount/namespace`/pods | less
// curl --cacert /run/secrets/kubernetes.io/serviceaccount/ca.crt -H "Authorization: Bearer `cat /run/secrets/kubernetes.io/serviceaccount/token`" https://kubernetes.default.svc/api/v1/nodes | less

function fetch_k8s_wrap() {
	//console.log("fetch k8s")
	return Promise.all([
		fsp.readFile("/run/secrets/kubernetes.io/serviceaccount/token"),
		fsp.readFile("/run/secrets/kubernetes.io/serviceaccount/namespace"),
		process.env.INGRESS_NAMESPACE,
		fsp.readFile("/run/secrets/kubernetes.io/serviceaccount/ca.crt"),
	]).then(([token, own_namespace, ingress_namespace, ca]) => {
		let agent = new https.Agent({
			ca: [ca]
		});
	
		return Promise.all([
			fetch('https://kubernetes.default.svc/api/v1/nodes', {
				agent,
				headers: {
					"Authorization": `Bearer ${token}`
				}
			}),
			fetch(`https://kubernetes.default.svc/api/v1/namespaces/${own_namespace}/pods?labelSelector=${process.env.APP_LABEL.replace(":", "%3D")}`, {
				agent,
				headers: {
					"Authorization": `Bearer ${token}`
				}
			}),
			fetch(`https://kubernetes.default.svc/api/v1/namespaces/${ingress_namespace}/pods?labelSelector=${process.env.INGRESS_LABEL.replace(":", "%3D")}`, {
				agent,
				headers: {
					"Authorization": `Bearer ${token}`
				}
			}),
		]).then((results) => {
			//console.log("transform to json", results);
			return Promise.all(results.map(async (value) => await value.json()))
		}).then(([nodes_res, own_pods, ingress_pods]) => {
			//console.log("test", nodes_res, own_pods, ingress_pods)
			
			const nodes_dict = {

			};
			
			let ingress_pod = null;

			nodes_res["items"].forEach(element => {
				const name = element["metadata"]["name"]
				nodes_dict[name] = {
					name,
					pods: []
				}
			});

			ingress_pods["items"].forEach(element => {
				const name = element["metadata"]["name"]
				const nodeName = element["spec"]["nodeName"]
				nodes_dict[nodeName]["pods"].push(name)
				ingress_pod = name
			});					

			own_pods["items"].forEach(element => {
				const name = element["metadata"]["name"]
				const nodeName = element["spec"]["nodeName"]
				nodes_dict[nodeName]["pods"].push(name)
			});

			return {
				nodes_dict,
				ingress_pod
			};
		});
	});
}

app.get('/', (req, res) => {
	const basicresponse = { 
		"ip": process.env.IP,
		"role": process.env.ROLE,
		"node": process.env.MY_NODE_NAME,
		"pod": process.env.MY_POD_NAME,
		"namespace": process.env.MY_POD_NAMESPACE,
		headers: JSON.stringify(req.headers)
	};
	
	if(process.env.ROLE == 'frontend')
	{
		Promise.all([
			Promise.all([
				Promise.resolve().then(() => { return { "id": "frontend", ...basicresponse}}),
				fetch_wrap(process.env.BACKEND_A),
				fetch_wrap(process.env.BACKEND_B),
			]),
			fetch_k8s_wrap()
		]).then(([results, { nodes_dict, ingress_pod }]) => {
			//console.log(results, nodes_dict);
			
			const node_blocks = []

			for (const [name, {pods}] of Object.entries(nodes_dict)) {
				node_blocks.push(`
					subgraph cluster_node_${name} {
						
						style=filled;
						color=lightgrey;
						node [style=filled,color=white];
						//a0 -> a1 -> a2 -> a3;
						"${name}" [style=invis]
						"${name}" -> ${pods.map(value => '"'+value+'"').join(" ->")} [style=invis]
						label = "Node ${name}";
					}				
				`)
			}
			
			const dia_input = `
			digraph G {

	rankdir = TL

	${node_blocks.join("\n")}
  
	"User" -> "${ingress_pod}"-> "${results[0]["pod"]}"->"${results[1]["pod"]}"  [constraint=false];
	"${results[0]["pod"]}"->"${results[2]["pod"]}"  [constraint=false];
	${Object.values(nodes_dict).map(value => '"'+value.name+'"').join("->")} [rank=same style=invis]


}`;

			//console.log(dia_input);

			return fsp.writeFile("/tmp/in", dia_input).then(() => {
				return execShellCommand("dot -Nfontname='Cantarell Regular' -Tpng -o /tmp/out /tmp/in | base64 -w 0", dia_input).then((svgCode) => {
					return fsp.readFile("/tmp/out").then((svgCode) => {
						return {
							message: results.map((entry) => `Hello from ${entry.id} ip: ${entry.ip} role: ${entry.role} pod: ${entry.pod} namespace: ${entry.namespace} node: ${entry.node}`).join("\n"),
							svg: svgCode
						}
					})
				});
			});
		}).then(({message, svg}) => {

			const svg_b64 = Buffer.from(svg).toString("base64");

			if (req.accepts('html')) {
				res.send(`<!doctype html5><html lang="de"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><meta http-equiv="refresh" content="5" /></head><body><pre>${message}</pre><hr/><img alt="My Image" src="data:image/png;base64,${svg_b64}" /><hr/><a href="/">Refresh</a></body></html>`);
				return;
			}

			res.type('txt').send(message);
		}).catch((error) => {
			res.send(`error occured: ${error}`);
			console.log(error);
		});
	}
	else
	{
		res.send(basicresponse);
	}
});

app.get('/health/', (req, res) => {
  res.send('OK');
});

app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);

